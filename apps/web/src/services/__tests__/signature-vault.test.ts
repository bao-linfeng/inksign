import type { StoredSignature } from '@/types/signature'
import { Buffer } from 'node:buffer'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WrongPinError } from '../signature-crypto'
import {
  changeSignaturePin,
  clearSignatures,
  closeVault,
  deleteSignature,
  isPersisted,
  isVaultAvailable,
  listSignatures,
  normalizeName,
  readSignature,
  renameSignature,
  requestPersistence,
  saveSignature,
  VAULT_MAX_ENTRIES,
  VAULT_MAX_PNG_BYTES,
  VaultError,
} from '../signature-vault'
// idb checks requests against the global IDB classes
import 'fake-indexeddb/auto'

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 9, 8, 7, 6, 5, 4, 3, 2])
const image = { pngBytes: png, width: 300, height: 100 }

/** Every record as IndexedDB holds it, read without the service */
async function rawRecords() {
  const db = await openDB('inksign')
  const all = await db.getAll('signatures') as StoredSignature[]
  db.close()
  return all
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array) {
  return Buffer.from(haystack).includes(Buffer.from(needle))
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught)
  return error instanceof VaultError ? error.code : error
}

describe('signature vault', () => {
  beforeEach(() => {
    closeVault()
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    closeVault()
    vi.unstubAllGlobals()
  })

  it('keeps saved signatures across connections (PRD FR-08)', async () => {
    const saved = await saveSignature({ name: '  全名 ', image })
    closeVault()

    const [entry, ...rest] = await listSignatures()

    expect(rest).toEqual([])
    expect(entry).toEqual(saved)
    expect(entry).toMatchObject({ name: '全名', encrypted: false, naturalWidth: 300, naturalHeight: 100 })
    expect(await readSignature(entry!)).toEqual(png)
  })

  it('stores a copy of the bytes, not the buffer behind a view', async () => {
    const buffer = new Uint8Array(1000)
    buffer.set(png, 100)
    await saveSignature({ name: 'a', image: { ...image, pngBytes: buffer.subarray(100, 100 + png.length) } })

    const [record] = await rawRecords()

    expect(record!.pngBytes!.buffer.byteLength).toBe(png.length)
  })

  it('stores PIN-protected signatures as ciphertext only', async () => {
    const saved = await saveSignature({ name: '全名', image, pin: 'abc123' })

    const [record] = await rawRecords()

    expect(record!.encrypted).toBe(true)
    expect(record!.pngBytes).toBeUndefined()
    expect(containsBytes(new Uint8Array(record!.cipher!), png.subarray(0, 8))).toBe(false)
    expect(JSON.stringify(record)).not.toContain('abc123')
    await expect(readSignature(saved, 'abc124')).rejects.toBeInstanceOf(WrongPinError)
    await expect(readSignature(saved)).rejects.toBeInstanceOf(WrongPinError)
    expect(await readSignature(saved, 'abc123')).toEqual(png)
  })

  it('lists signatures oldest first and skips unreadable records', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2000)
    await saveSignature({ name: 'later', image })
    now.mockReturnValue(1000)
    await saveSignature({ name: 'earlier', image })
    now.mockRestore()
    const db = await openDB('inksign')
    await db.put('signatures', { id: 'broken', name: 'x', createdAt: 0, encrypted: false })
    db.close()

    expect((await listSignatures()).map(entry => entry.name)).toEqual(['earlier', 'later'])
  })

  it('refuses a 21st signature and images over 2 MB (PRD FR-08)', async () => {
    for (let i = 0; i < VAULT_MAX_ENTRIES; i++)
      await saveSignature({ name: `签名 ${i}`, image })

    expect(await errorCode(saveSignature({ name: 'one more', image }))).toBe('full')
    expect(await listSignatures()).toHaveLength(VAULT_MAX_ENTRIES)

    await clearSignatures()
    const huge = { ...image, pngBytes: new Uint8Array(VAULT_MAX_PNG_BYTES + 1) }
    expect(await errorCode(saveSignature({ name: 'huge', image: huge }))).toBe('too-large')
    expect(await listSignatures()).toEqual([])
  })

  it('reports a full disk as a quota error (PRD §9)', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    expect(await errorCode(saveSignature({ name: 'a', image }))).toBe('quota')
    vi.restoreAllMocks()
  })

  it('handles an asynchronous write failure without an unhandled transaction rejection', async () => {
    await saveSignature({ name: 'existing', image })
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore) {
      const request = this.get('missing')
      this.transaction.abort()
      return request as IDBRequest<IDBValidKey>
    })

    expect(await errorCode(saveSignature({ name: 'failed', image }))).toBe('failed')
    expect((await listSignatures()).map(entry => entry.name)).toEqual(['existing'])
    vi.restoreAllMocks()
  })

  it('renames, keeping the old name for a blank one', async () => {
    const { id } = await saveSignature({ name: '全名', image })

    expect((await renameSignature(id, ' 简签 ')).name).toBe('简签')
    expect((await renameSignature(id, '   ')).name).toBe('简签')
    expect((await listSignatures())[0]!.name).toBe('简签')
    expect(await errorCode(renameSignature('gone', 'x'))).toBe('missing')
  })

  it('sets, changes and removes a PIN, checking the current one first (PRD FR-08)', async () => {
    const { id } = await saveSignature({ name: '全名', image })

    const locked = await changeSignaturePin(id, undefined, 'first1')
    expect(locked.entry).toMatchObject({ id, name: '全名', encrypted: true })
    expect(locked.entry.pngBytes).toBeUndefined()
    expect(locked.pngBytes).toEqual(png)

    await expect(changeSignaturePin(id, 'wrong1', 'second2')).rejects.toBeInstanceOf(WrongPinError)
    const changed = await changeSignaturePin(id, 'first1', 'second2')
    await expect(readSignature(changed.entry, 'first1')).rejects.toBeInstanceOf(WrongPinError)
    expect(await readSignature(changed.entry, 'second2')).toEqual(png)

    await expect(changeSignaturePin(id, 'first1', null)).rejects.toBeInstanceOf(WrongPinError)
    const plain = await changeSignaturePin(id, 'second2', null)
    expect(plain.entry).toMatchObject({ encrypted: false, pngBytes: png })
    expect(plain.entry.cipher).toBeUndefined()

    const [record] = await rawRecords()
    expect(record).toEqual(plain.entry)
  })

  it('deletes one signature, or all of them without leftovers (PRD FR-08)', async () => {
    const a = await saveSignature({ name: 'a', image })
    await saveSignature({ name: 'b', image, pin: 'abc123' })
    await saveSignature({ name: 'c', image })

    await deleteSignature(a.id)
    expect((await listSignatures()).map(entry => entry.name)).toEqual(['b', 'c'])

    await clearSignatures()
    expect(await rawRecords()).toEqual([])
  })

  it('starts empty after the site data was cleared (PRD FR-08)', async () => {
    await saveSignature({ name: 'a', image })
    closeVault()
    vi.stubGlobal('indexedDB', new IDBFactory())

    expect(await listSignatures()).toEqual([])
  })

  it('reports an unusable IndexedDB as unavailable (PRD §9)', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(await isVaultAvailable()).toBe(false)
    expect(await errorCode(listSignatures())).toBe('unavailable')

    closeVault()
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('denied', 'InvalidStateError')
      },
    })
    expect(await errorCode(saveSignature({ name: 'a', image }))).toBe('unavailable')

    // A later attempt tries again
    vi.stubGlobal('indexedDB', new IDBFactory())
    expect(await isVaultAvailable()).toBe(true)
  })

  it('asks for persistent storage and reports what the browser said', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => true, persisted: async () => false } })
    expect(await requestPersistence()).toBe(true)
    expect(await isPersisted()).toBe(false)

    vi.stubGlobal('navigator', {})
    expect(await requestPersistence()).toBe(false)
    expect(await isPersisted()).toBeNull()
  })
})

describe('normalizeName', () => {
  it('trims, collapses spaces and keeps 20 characters', () => {
    expect(normalizeName('  张   三  ')).toBe('张 三')
    expect(normalizeName('一二三四五六七八九十一二三四五六七八九十多出来')).toBe('一二三四五六七八九十一二三四五六七八九十')
    expect(normalizeName('   ')).toBe('')
  })
})
