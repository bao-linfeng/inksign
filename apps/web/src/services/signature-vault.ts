import type { DBSchema, IDBPDatabase } from 'idb'
import type { SignatureImage } from './signature-image'
import type { StoredSignature } from '@/types/signature'
import { openDB } from 'idb'

import { decryptImage, encryptImage, WrongPinError } from './signature-crypto'

/**
 * The signature library (PRD FR-08): signatures the user chose to save on this device, in
 * IndexedDB. Nothing else is stored here; PDFs and file names never are (FR-07).
 */

/** PRD FR-08 limits */
export const VAULT_MAX_ENTRIES = 20
export const VAULT_MAX_PNG_BYTES = 2 * 1024 * 1024
export const SIGNATURE_NAME_MAX_LENGTH = 20

const DB_NAME = 'inksign'
const DB_VERSION = 1
const STORE = 'signatures'

interface VaultSchema extends DBSchema {
  [STORE]: { key: string, value: StoredSignature }
}

export type VaultErrorCode = 'unavailable' | 'full' | 'too-large' | 'quota' | 'missing' | 'failed'

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
}

export const WRONG_PIN_MESSAGE = 'PIN 不正确，请重试。忘记 PIN 只能删除该签名后重新创建。'

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
        db.createObjectStore(STORE, { keyPath: 'id' })
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
    ? entry.cipher instanceof ArrayBuffer && entry.iv instanceof Uint8Array && entry.salt instanceof Uint8Array && typeof entry.kdfIterations === 'number'
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
}

/** Saves a signature; refuses more than 20 entries or more than 2 MB of PNG (PRD FR-08). */
export async function saveSignature({ name, image, pin = null }: NewSignature): Promise<StoredSignature> {
  if (image.pngBytes.length > VAULT_MAX_PNG_BYTES)
    throw new VaultError('too-large')
  // Before the transaction: it commits as soon as it waits for anything but IndexedDB
  const entry: StoredSignature = {
    id: newId(),
    name: normalizeName(name) || '签名',
    createdAt: Date.now(),
    naturalWidth: image.width,
    naturalHeight: image.height,
    ...await protect(image.pngBytes, pin),
  }
  return run(async (db) => {
    const tx = db.transaction(STORE, 'readwrite')
    const count = await tx.store.count()
    if (count >= VAULT_MAX_ENTRIES) {
      await tx.done
      throw new VaultError('full')
    }
    await Promise.all([tx.store.add(entry), tx.done])
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
  return decryptImage({ cipher: entry.cipher!, iv: entry.iv!, salt: entry.salt!, kdfIterations: entry.kdfIterations! }, pin ?? '')
}

/**
 * Sets, changes (`newPin`) or removes (`null`) the PIN of an entry. A protected entry needs its
 * current PIN first (PRD FR-08); a wrong one throws `WrongPinError` and changes nothing. Returns
 * the new entry with its plain bytes, which were decrypted on the way.
 */
export async function changeSignaturePin(id: string, currentPin: string | undefined, newPin: string | null) {
  const entry = await find(id)
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
  await run(db => db.clear(STORE))
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
