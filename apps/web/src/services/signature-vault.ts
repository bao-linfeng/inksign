import type { DBSchema, IDBPDatabase } from 'idb'
import type { EncryptedImage } from './signature-crypto'
import type { SignatureImage } from './signature-image'
import type { StoredSignature } from '@/types/signature'
import { openDB } from 'idb'

import { decryptImage, decryptImageWithKey, deriveDecryptionKey, encryptImage, encryptImageWithKey, importLibraryKey, WrongPinError } from './signature-crypto'

/**
 * The signature library (PRD FR-08): signatures the user chose to save on this device, in
 * IndexedDB, alongside explicit local preferences. PDFs and file names never are (FR-07).
 */

/** PRD FR-08 limits */
export const VAULT_MAX_ENTRIES = 20
export const VAULT_MAX_PNG_BYTES = 2 * 1024 * 1024
export const SIGNATURE_NAME_MAX_LENGTH = 20

const DB_NAME = 'inksign'
const DB_VERSION = 3
const STORE = 'signatures'
const KEY_STORE = 'remembered-keys'
const SETTINGS_STORE = 'settings'
const LIBRARY_KEY_ID = 'library'

export interface LibrarySettings {
  autoSave: boolean
  rememberUnlock: boolean
  pin: EncryptedImage | null
  revision: number
}

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = { autoSave: false, rememberUnlock: false, pin: null, revision: 0 }

interface VaultSchema extends DBSchema {
  [STORE]: { key: string, value: StoredSignature }
  [KEY_STORE]: { key: string, value: CryptoKey }
  [SETTINGS_STORE]: { key: string, value: LibrarySettings }
}

export type VaultErrorCode = 'unavailable' | 'full' | 'too-large' | 'quota' | 'missing' | 'failed' | 'locked' | 'legacy-locked' | 'changed'

export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode, options?: ErrorOptions) {
    super(`Signature library: ${code}`, options)
    this.name = 'VaultError'
  }
}

/** PRD §9 */
export const vaultErrorMessages: Record<VaultErrorCode, string> = {
  'unavailable': '当前浏览器无法保存签名，可下载 PNG 备份。',
  'full': `最多保存 ${VAULT_MAX_ENTRIES} 个签名，请先删除不用的签名。`,
  'too-large': '签名图片超过 2 MB，无法保存到本设备。可下载 PNG 备份。',
  'quota': '签名保存失败，浏览器存储空间不足。可下载签名 PNG 备份。',
  'missing': '该签名已不存在，可能已在其他标签页中删除。',
  'failed': '签名库操作失败，请重试。',
  'locked': '请先输入 PIN 解锁签名库。',
  'legacy-locked': '请先在设置中解锁旧版受保护签名，再统一设置 PIN。',
  'changed': '签名库已在其他页面更新，请刷新后重试。',
}

export const WRONG_PIN_MESSAGE = 'PIN 不正确，请重试。忘记 PIN 无法找回，可在设置中清空签名库后重新创建。'

/** What to tell the user about a failed library operation. */
export function vaultErrorMessage(error: unknown) {
  if (error instanceof WrongPinError)
    return WRONG_PIN_MESSAGE
  return vaultErrorMessages[error instanceof VaultError ? error.code : 'failed']
}

let connection: Promise<IDBPDatabase<VaultSchema>> | undefined

function database() {
  connection ??= (async () => {
    if (typeof indexedDB === 'undefined')
      throw new VaultError('unavailable')
    return openDB<VaultSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(KEY_STORE))
          db.createObjectStore(KEY_STORE)
        if (!db.objectStoreNames.contains(SETTINGS_STORE))
          db.createObjectStore(SETTINGS_STORE)
      },
      // Another tab opens a newer version: step aside and reconnect on the next call
      blocking() {
        closeVault()
      },
      terminated() {
        connection = undefined
      },
    })
  })().catch((cause: unknown) => {
    connection = undefined
    // e.g. Firefox private windows used to refuse IndexedDB altogether
    throw cause instanceof VaultError ? cause : new VaultError('unavailable', { cause })
  })
  return connection
}

/** Closes the connection; the next call opens a new one. */
export function closeVault() {
  const closing = connection
  connection = undefined
  void closing?.then(db => db.close(), () => {})
}

function toVaultError(error: unknown) {
  if (error instanceof VaultError)
    return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return new VaultError('quota', { cause: error })
  return new VaultError('failed', { cause: error })
}

async function run<T>(task: (db: IDBPDatabase<VaultSchema>) => Promise<T>): Promise<T> {
  const db = await database()
  try {
    return await task(db)
  }
  catch (error) {
    throw toVaultError(error)
  }
}

/** Opens the library once to find out whether this browser lets us store anything. */
export async function isVaultAvailable() {
  try {
    await database()
    return true
  }
  catch {
    return false
  }
}

function isStoredSignature(value: unknown): value is StoredSignature {
  const entry = value as Partial<StoredSignature> | null
  if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.createdAt !== 'number')
    return false
  if (!(Number(entry.naturalWidth) > 0 && Number(entry.naturalHeight) > 0))
    return false
  return entry.encrypted
    ? entry.cipher instanceof ArrayBuffer && entry.iv instanceof Uint8Array && (entry.protection === 'library' || (entry.salt instanceof Uint8Array && typeof entry.kdfIterations === 'number'))
    : entry.pngBytes instanceof Uint8Array
}

/** Saved signatures, oldest first. Unreadable entries (e.g. written by a future version) are skipped. */
export async function listSignatures(): Promise<StoredSignature[]> {
  const all = await run(db => db.getAll(STORE))
  return all.filter(isStoredSignature).sort((a, b) => a.createdAt - b.createdAt)
}

/** Trims and shortens a signature name; an empty name stays empty for the caller to replace. */
export function normalizeName(name: string) {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, SIGNATURE_NAME_MAX_LENGTH).join('')
}

// Not crypto.randomUUID(): it is missing on plain-HTTP origins such as a LAN test server
function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The stored form of `pngBytes`: as is, or encrypted with `pin`. */
async function protect(pngBytes: Uint8Array, pin: string | null): Promise<Pick<StoredSignature, 'encrypted' | 'pngBytes' | 'cipher' | 'iv' | 'salt' | 'kdfIterations'>> {
  if (pin === null) {
    // A copy: storing a view would store the whole buffer behind it
    return { encrypted: false, pngBytes: pngBytes.slice() }
  }
  return { encrypted: true, ...await encryptImage(pngBytes, pin) }
}

export interface NewSignature {
  name: string
  image: SignatureImage
  /** Encrypts the signature with this PIN */
  pin?: string | null
  key?: CryptoKey
  settingsRevision?: number
}

/** Saves a signature; refuses more than 20 entries or more than 2 MB of PNG (PRD FR-08). */
export async function saveSignature({ name, image, pin = null, key, settingsRevision }: NewSignature): Promise<StoredSignature> {
  if (image.pngBytes.length > VAULT_MAX_PNG_BYTES)
    throw new VaultError('too-large')
  // Before the transaction: it commits as soon as it waits for anything but IndexedDB
  const entry: StoredSignature = {
    id: newId(),
    name: normalizeName(name) || '签名',
    createdAt: Date.now(),
    naturalWidth: image.width,
    naturalHeight: image.height,
    ...key ? { encrypted: true, protection: 'library' as const, ...await encryptImageWithKey(image.pngBytes, key) } : await protect(image.pngBytes, pin),
  }
  return run(async (db) => {
    const tx = db.transaction([STORE, SETTINGS_STORE], 'readwrite')
    const settings = await tx.objectStore(SETTINGS_STORE).get('library') ?? DEFAULT_LIBRARY_SETTINGS
    if (settingsRevision !== undefined && settings.revision !== settingsRevision) {
      await tx.done
      throw new VaultError('changed')
    }
    if (settings.pin && !key) {
      await tx.done
      throw new VaultError('locked')
    }
    const count = await tx.objectStore(STORE).count()
    if (count >= VAULT_MAX_ENTRIES) {
      await tx.done
      throw new VaultError('full')
    }
    await Promise.all([tx.objectStore(STORE).add(entry), tx.done])
    return entry
  })
}

/** Replaces an entry, provided it still exists. */
async function replace(entry: StoredSignature) {
  return run(async (db) => {
    const tx = db.transaction(STORE, 'readwrite')
    if (!await tx.store.getKey(entry.id)) {
      await tx.done
      throw new VaultError('missing')
    }
    await Promise.all([tx.store.put(entry), tx.done])
    return entry
  })
}

async function find(id: string) {
  const entry = await run(db => db.get(STORE, id))
  if (!entry || !isStoredSignature(entry))
    throw new VaultError('missing')
  return entry
}

export async function renameSignature(id: string, name: string): Promise<StoredSignature> {
  const entry = await find(id)
  return replace({ ...entry, name: normalizeName(name) || entry.name })
}

/**
 * The PNG bytes of an entry. A protected one needs its PIN and throws `WrongPinError` for a
 * wrong one (PRD FR-08).
 */
export async function readSignature(entry: StoredSignature, pin?: string): Promise<Uint8Array> {
  if (!entry.encrypted)
    return entry.pngBytes!
  if (entry.protection === 'library') {
    const settings = await readLibrarySettings()
    if (!settings.pin)
      throw new VaultError('changed')
    return readLibrarySignature(entry, await unlockLibraryKey(settings, pin ?? ''))
  }
  return decryptImage({ cipher: entry.cipher!, iv: entry.iv!, salt: entry.salt!, kdfIterations: entry.kdfIterations! }, pin ?? '')
}

/** Stores only a non-extractable key, never the PIN or its derived bytes. */
export async function rememberSignatureKey(entry: StoredSignature, pin: string) {
  if (!entry.encrypted)
    return
  if (entry.protection === 'library')
    throw new VaultError('failed')
  const key = await deriveDecryptionKey(pin, entry.salt!, entry.kdfIterations!)
  await run(db => db.put(KEY_STORE, key, entry.id))
}

/** Tries the browser-local remembered key; invalid or stale keys are discarded. */
export async function readRememberedSignature(entry: StoredSignature): Promise<Uint8Array | null> {
  if (!entry.encrypted)
    return null
  if (entry.protection === 'library')
    return null
  const key = await run(db => db.get(KEY_STORE, entry.id))
  if (!key)
    return null
  try {
    return await decryptImageWithKey({ cipher: entry.cipher!, iv: entry.iv! }, key)
  }
  catch {
    await forgetRememberedSignature(entry.id)
    return null
  }
}

export async function forgetRememberedSignature(id: string) {
  await run(db => db.delete(KEY_STORE, id))
}

export async function clearRememberedSignatures() {
  await run(db => db.clear(KEY_STORE))
}

/**
 * Sets, changes (`newPin`) or removes (`null`) the PIN of an entry. A protected entry needs its
 * current PIN first (PRD FR-08); a wrong one throws `WrongPinError` and changes nothing. Returns
 * the new entry with its plain bytes, which were decrypted on the way.
 */
export async function changeSignaturePin(id: string, currentPin: string | undefined, newPin: string | null) {
  const entry = await find(id)
  if (entry.protection === 'library')
    throw new VaultError('failed')
  const pngBytes = await readSignature(entry, currentPin)
  const { id: entryId, name, createdAt, naturalWidth, naturalHeight } = entry
  const updated = await replace({ id: entryId, name, createdAt, naturalWidth, naturalHeight, ...await protect(pngBytes, newPin) })
  return { entry: updated, pngBytes }
}

export async function deleteSignature(id: string) {
  await run(db => db.delete(STORE, id))
}

/** Deletes every saved signature (PRD FR-08: nothing may be left behind). */
export async function clearSignatures() {
  await run(async (db) => {
    const tx = db.transaction([STORE, SETTINGS_STORE, KEY_STORE], 'readwrite')
    const settings = await tx.objectStore(SETTINGS_STORE).get('library') ?? DEFAULT_LIBRARY_SETTINGS
    const writes: Promise<unknown>[] = [tx.done]
    try {
      writes.push(tx.objectStore(STORE).clear())
      writes.push(tx.objectStore(KEY_STORE).clear())
      writes.push(tx.objectStore(SETTINGS_STORE).put({ ...settings, pin: null, revision: settings.revision + 1 }, 'library'))
      await Promise.all(writes)
    }
    catch (error) {
      try {
        tx.abort()
      }
      catch {}
      await Promise.allSettled(writes)
      throw error
    }
  })
}

export async function readLibrarySettings(): Promise<LibrarySettings> {
  return await run(db => db.get(SETTINGS_STORE, 'library')) ?? { ...DEFAULT_LIBRARY_SETTINGS }
}

export async function updateLibraryPreferences(patch: Partial<Pick<LibrarySettings, 'autoSave' | 'rememberUnlock'>>, expectedRevision?: number) {
  return run(async (db) => {
    const tx = db.transaction([SETTINGS_STORE, KEY_STORE], 'readwrite')
    const current = await tx.objectStore(SETTINGS_STORE).get('library') ?? DEFAULT_LIBRARY_SETTINGS
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      await tx.done
      throw new VaultError('changed')
    }
    const next = { ...current, ...patch, revision: current.revision + 1 }
    const writes: Promise<unknown>[] = [tx.done]
    try {
      writes.push(tx.objectStore(SETTINGS_STORE).put(next, 'library'))
      if (patch.rememberUnlock === false)
        writes.push(tx.objectStore(KEY_STORE).clear())
      await Promise.all(writes)
    }
    catch (error) {
      try {
        tx.abort()
      }
      catch {}
      await Promise.allSettled(writes)
      throw error
    }
    return next
  })
}

export async function unlockLibraryKey(settings: LibrarySettings, pin: string) {
  if (!settings.pin)
    throw new VaultError('changed')
  return importLibraryKey(await decryptImage(settings.pin, pin))
}

export async function readLibrarySignature(entry: StoredSignature, key: CryptoKey) {
  return decryptImageWithKey({ cipher: entry.cipher!, iv: entry.iv! }, key)
}

export async function rememberLibraryKey(key: CryptoKey, expectedRevision?: number) {
  await run(async (db) => {
    const tx = db.transaction([KEY_STORE, SETTINGS_STORE], 'readwrite')
    const settings = await tx.objectStore(SETTINGS_STORE).get('library') ?? DEFAULT_LIBRARY_SETTINGS
    if (!settings.pin || !settings.rememberUnlock || (expectedRevision !== undefined && settings.revision !== expectedRevision)) {
      await tx.done
      throw new VaultError('changed')
    }
    await Promise.all([tx.objectStore(KEY_STORE).put(key, LIBRARY_KEY_ID), tx.done])
  })
}

export async function readRememberedLibraryKey() {
  return run(db => db.get(KEY_STORE, LIBRARY_KEY_ID))
}

function sameBytes(a: ArrayBuffer | Uint8Array | undefined, b: ArrayBuffer | Uint8Array | undefined) {
  if (!a || !b)
    return a === b
  const first = a instanceof ArrayBuffer ? new Uint8Array(a) : a
  const second = b instanceof ArrayBuffer ? new Uint8Array(b) : b
  return first.length === second.length && first.every((byte, i) => byte === second[i])
}

export async function changeLibraryPin(settings: LibrarySettings, entries: StoredSignature[], images: Map<string, Uint8Array>, newPin: string | null) {
  const secret = newPin === null ? null : crypto.getRandomValues(new Uint8Array(32))
  const key = secret ? await importLibraryKey(secret) : null
  const nextSettings: LibrarySettings = { ...settings, pin: secret ? await encryptImage(secret, newPin!) : null, revision: settings.revision + 1 }
  const updated = await Promise.all(entries.map(async (entry): Promise<StoredSignature> => {
    const bytes = images.get(entry.id)
    if (!bytes)
      throw new VaultError('legacy-locked')
    const { id, name, createdAt, naturalWidth, naturalHeight } = entry
    return { id, name, createdAt, naturalWidth, naturalHeight, ...key ? { encrypted: true, protection: 'library' as const, ...await encryptImageWithKey(bytes, key) } : { encrypted: false, pngBytes: bytes.slice() } }
  }))
  await run(async (db) => {
    const tx = db.transaction([STORE, SETTINGS_STORE, KEY_STORE], 'readwrite')
    const currentSettings = await tx.objectStore(SETTINGS_STORE).get('library') ?? DEFAULT_LIBRARY_SETTINGS
    const current = await tx.objectStore(STORE).getAll()
    const unchanged = current.length === entries.length && current.every(entry => entries.some(previous => previous.id === entry.id && previous.name === entry.name && previous.encrypted === entry.encrypted && previous.protection === entry.protection && sameBytes(previous.cipher, entry.cipher) && sameBytes(previous.pngBytes, entry.pngBytes) && sameBytes(previous.iv, entry.iv)))
    if (currentSettings.revision !== settings.revision || !unchanged) {
      await tx.done
      throw new VaultError('changed')
    }
    const writes: Promise<unknown>[] = [tx.done]
    try {
      for (const entry of updated)
        writes.push(tx.objectStore(STORE).put(entry))
      writes.push(tx.objectStore(SETTINGS_STORE).put(nextSettings, 'library'))
      writes.push(tx.objectStore(KEY_STORE).clear())
      if (key && settings.rememberUnlock)
        writes.push(tx.objectStore(KEY_STORE).put(key, LIBRARY_KEY_ID))
      await Promise.all(writes)
    }
    catch (error) {
      try {
        tx.abort()
      }
      catch {}
      await Promise.allSettled(writes)
      throw error
    }
  })
  return { settings: nextSettings, entries: updated, key }
}

/**
 * Asks the browser not to evict the library under storage pressure (PRD FR-08). Browsers may
 * refuse without asking the user; `false` means saved signatures can still be cleaned up.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return await navigator.storage?.persist?.() ?? false
  }
  catch {
    return false
  }
}

/** Whether persistence was granted; `null` when the browser cannot tell. */
export async function isPersisted(): Promise<boolean | null> {
  try {
    return await navigator.storage?.persisted?.() ?? null
  }
  catch {
    return null
  }
}
