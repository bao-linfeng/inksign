import type { SignatureImage } from '@/services/signature-image'
import type { StoredSignature } from '@/types/signature'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  changeSignaturePin,
  clearSignatures,
  deleteSignature,
  isPersisted,
  listSignatures,
  readSignature,
  renameSignature,
  requestPersistence,
  saveSignature,
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
  /** PIN protection needs Web Crypto, which browsers offer on secure origins only */
  const canEncrypt = typeof globalThis.crypto?.subtle?.deriveKey === 'function'

  const available = computed(() => status.value !== 'unavailable')
  const full = computed(() => entries.value.length >= VAULT_MAX_ENTRIES)
  const hasUnlocked = computed(() => unlocked.value.size > 0)

  let loading: Promise<void> | undefined

  /** Reads the library once; later calls wait for the same read. */
  function load() {
    loading ??= (async () => {
      status.value = 'loading'
      try {
        entries.value = await listSignatures()
        status.value = 'ready'
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
  async function save(name: string, image: SignatureImage, pin: string | null = null): Promise<StoredSignature> {
    await load()
    if (status.value === 'unavailable')
      throw new VaultError('unavailable')
    const entry = await saveSignature({ name, image, pin })
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
    const bytes = await readSignature(entry, pin)
    if (entry.encrypted) {
      remember(id, bytes)
      refreshPreviews()
    }
    return bytes
  }

  /** Forgets every unlocked signature: they need their PIN again (PRD FR-08). */
  function lock() {
    forgetSessionSignatures(entries.value.filter(entry => entry.encrypted).map(entry => entry.id))
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

  /** Sets, changes or (`newPin: null`) removes a PIN; a protected entry needs its current PIN. */
  async function changePin(id: string, currentPin: string | undefined, newPin: string | null) {
    const { entry, pngBytes } = await changeSignaturePin(id, currentPin, newPin)
    if (entry.encrypted)
      remember(id, pngBytes)
    else
      unlocked.value = new Map([...unlocked.value].filter(([key]) => key !== id))
    replaceEntry(entry)
  }

  async function remove(id: string) {
    await deleteSignature(id)
    forgetSessionSignatures([id])
    setEntries(entries.value.filter(e => e.id !== id))
  }

  async function clear() {
    await clearSignatures()
    forgetSessionSignatures(entries.value.map(entry => entry.id))
    setEntries([])
  }

  return {
    status,
    entries,
    previews,
    persisted,
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
    changePin,
    remove,
    clear,
  }
})
