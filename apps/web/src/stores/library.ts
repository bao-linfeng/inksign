import type { SignatureImage } from '@/services/signature-image'
import type { LibrarySettings } from '@/services/signature-vault'
import type { StoredSignature } from '@/types/signature'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  changeLibraryPin,
  clearRememberedSignatures,
  clearSignatures,
  DEFAULT_LIBRARY_SETTINGS,
  deleteSignature,
  forgetRememberedSignature,
  isPersisted,
  listSignatures,
  readLibrarySettings,
  readLibrarySignature,
  readRememberedLibraryKey,
  readRememberedSignature,
  readSignature,
  rememberLibraryKey,
  rememberSignatureKey,
  renameSignature,
  requestPersistence,
  saveSignature,
  unlockLibraryKey,
  updateLibraryPreferences,
  VAULT_MAX_ENTRIES,
  VaultError,
} from '@/services/signature-vault'

import { useSigningStore } from './signing'

/**
 * The signature library as the UI sees it (PRD FR-08). Saved entries come from IndexedDB; the
 * plain bytes of PIN-protected entries unlocked in this session stay in memory only, until the
 * page closes or the user locks the library.
 */
export const useLibraryStore = defineStore('library', () => {
  const signing = useSigningStore()
  const status = ref<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const entries = shallowRef<StoredSignature[]>([])
  /** Plain PNG bytes of protected entries unlocked in this session */
  const unlocked = shallowRef(new Map<string, Uint8Array>())
  /** Object URLs of the entries whose bytes are at hand */
  const previews = shallowRef(new Map<string, string>())
  /** Whether the browser granted persistent storage; `null` when unknown */
  const persisted = ref<boolean | null>(null)
  const settings = shallowRef<LibrarySettings>({ ...DEFAULT_LIBRARY_SETTINGS })
  const libraryKey = shallowRef<CryptoKey | null>(null)
  /** PIN protection needs Web Crypto, which browsers offer on secure origins only */
  const canEncrypt = typeof globalThis.crypto?.subtle?.deriveKey === 'function'

  const available = computed(() => status.value !== 'unavailable')
  const full = computed(() => entries.value.length >= VAULT_MAX_ENTRIES)
  const hasUnlocked = computed(() => unlocked.value.size > 0)
  const pinEnabled = computed(() => settings.value.pin !== null)
  const locked = computed(() => pinEnabled.value && libraryKey.value === null)
  const legacyEntries = computed(() => entries.value.filter(entry => entry.encrypted && entry.protection !== 'library'))

  let loading: Promise<void> | undefined

  /** Reads the library once; later calls wait for the same read. */
  function load() {
    loading ??= (async () => {
      status.value = 'loading'
      try {
        entries.value = await listSignatures()
        settings.value = await readLibrarySettings()
        status.value = 'ready'
        if (settings.value.rememberUnlock && settings.value.pin) {
          const key = await readRememberedLibraryKey()
          if (key) {
            try {
              await restoreLibrary(key)
            }
            catch {
              await clearRememberedSignatures()
            }
          }
        }
        for (const entry of entries.value) {
          const bytes = await readRememberedSignature(entry)
          if (bytes)
            remember(entry.id, bytes)
        }
        refreshPreviews()
        persisted.value = await isPersisted()
      }
      catch {
        status.value = 'unavailable'
      }
    })()
    return loading
  }

  function bytesOf(id: string): Uint8Array | null {
    const entry = entries.value.find(e => e.id === id)
    return entry?.pngBytes ?? unlocked.value.get(id) ?? null
  }

  function isLocked(entry: StoredSignature) {
    return entry.encrypted && !unlocked.value.has(entry.id)
  }

  /** Keeps one object URL per entry whose bytes are at hand and revokes the others. */
  function refreshPreviews() {
    const next = new Map<string, string>()
    for (const entry of entries.value) {
      const bytes = bytesOf(entry.id)
      if (!bytes)
        continue
      next.set(entry.id, previews.value.get(entry.id) ?? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })))
    }
    for (const [id, url] of previews.value) {
      if (next.get(id) !== url)
        URL.revokeObjectURL(url)
    }
    previews.value = next
  }

  function setEntries(next: StoredSignature[]) {
    entries.value = next
    const ids = new Set(next.map(e => e.id))
    unlocked.value = new Map([...unlocked.value].filter(([id]) => ids.has(id)))
    refreshPreviews()
  }

  function replaceEntry(entry: StoredSignature) {
    setEntries(entries.value.map(e => (e.id === entry.id ? entry : e)))
  }

  function remember(id: string, bytes: Uint8Array) {
    unlocked.value = new Map(unlocked.value).set(id, bytes)
  }

  /**
   * Saves a signature (PRD FR-08). The first save asks the browser for persistent storage. A
   * PIN-protected signature counts as unlocked for the rest of the session.
   */
  async function save(name: string, image: SignatureImage): Promise<StoredSignature> {
    await load()
    if (status.value === 'unavailable')
      throw new VaultError('unavailable')
    if (locked.value)
      throw new VaultError('locked')
    const entry = await saveSignature({ name, image, key: libraryKey.value ?? undefined, settingsRevision: settings.value.revision })
    if (entry.encrypted)
      remember(entry.id, image.pngBytes)
    setEntries([...entries.value, entry])
    if (!persisted.value)
      persisted.value = await requestPersistence()
    return entry
  }

  /** Unlocks a protected entry for this session; throws `WrongPinError` for a wrong PIN. */
  async function unlock(id: string, pin: string): Promise<Uint8Array> {
    const entry = entries.value.find(e => e.id === id)
    if (!entry)
      throw new VaultError('missing')
    if (entry.protection === 'library') {
      await unlockVault(pin)
      return bytesOf(id)!
    }
    const bytes = await readSignature(entry, pin)
    if (entry.encrypted) {
      remember(id, bytes)
      if (settings.value.rememberUnlock)
        await rememberSignatureKey(entry, pin)
      refreshPreviews()
    }
    return bytes
  }

  /** Forgets every unlocked signature: they need their PIN again (PRD FR-08). */
  async function lock() {
    await clearRememberedSignatures()
    const ids = entries.value.filter(entry => entry.encrypted).map(entry => entry.id)
    forgetSessionSignatures(ids)
    libraryKey.value = null
    unlocked.value = new Map()
    refreshPreviews()
  }

  function forgetSessionSignatures(ids: string[]) {
    for (const source of [...signing.sources]) {
      if (source.libraryId && ids.includes(source.libraryId))
        signing.removeSource(source.id)
    }
  }

  async function rename(id: string, name: string) {
    replaceEntry(await renameSignature(id, name))
  }

  async function restoreLibrary(key: CryptoKey) {
    const decrypted = await Promise.all(entries.value.filter(entry => entry.protection === 'library').map(async entry => [entry.id, await readLibrarySignature(entry, key)] as const))
    unlocked.value = new Map([...unlocked.value, ...decrypted])
    libraryKey.value = key
    refreshPreviews()
  }

  async function unlockVault(pin: string) {
    await load()
    const key = await unlockLibraryKey(settings.value, pin)
    await restoreLibrary(key)
    if (settings.value.rememberUnlock)
      await rememberLibraryKey(key, settings.value.revision)
  }

  async function preferences(patch: Partial<Pick<LibrarySettings, 'autoSave' | 'rememberUnlock'>>) {
    await load()
    settings.value = await updateLibraryPreferences(patch, settings.value.revision)
    if (patch.rememberUnlock && libraryKey.value)
      await rememberLibraryKey(libraryKey.value, settings.value.revision)
  }

  async function setPin(currentPin: string, newPin: string | null) {
    await load()
    const key = pinEnabled.value ? await unlockLibraryKey(settings.value, currentPin) : null
    const images = new Map<string, Uint8Array>()
    for (const entry of entries.value) {
      const bytes = entry.protection === 'library' && key ? await readLibrarySignature(entry, key) : bytesOf(entry.id)
      if (!bytes)
        throw new VaultError('legacy-locked')
      images.set(entry.id, bytes)
    }
    const result = await changeLibraryPin(settings.value, entries.value, images, newPin)
    settings.value = result.settings
    libraryKey.value = result.key
    unlocked.value = result.key ? images : new Map()
    setEntries(result.entries)
  }

  async function remove(id: string) {
    await deleteSignature(id)
    await forgetRememberedSignature(id).catch(() => {})
    forgetSessionSignatures([id])
    setEntries(entries.value.filter(e => e.id !== id))
  }

  async function clear() {
    await clearSignatures()
    settings.value = await readLibrarySettings()
    libraryKey.value = null
    forgetSessionSignatures(entries.value.map(entry => entry.id))
    setEntries([])
  }

  return {
    status,
    entries,
    previews,
    persisted,
    settings,
    pinEnabled,
    locked,
    legacyEntries,
    canEncrypt,
    available,
    full,
    hasUnlocked,
    load,
    bytesOf,
    isLocked,
    save,
    unlock,
    lock,
    rename,
    unlockVault,
    preferences,
    setPin,
    remove,
    clear,
  }
})
