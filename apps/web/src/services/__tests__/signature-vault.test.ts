import type { StoredSignature } from '@/types/signature'
import { Buffer } from 'node:buffer'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveDecryptionKey, encryptImage, WrongPinError } from '../signature-crypto'
import {
  changeLibraryPin,
  changeSignaturePin,
  clearSignatures,
  closeVault,
  deleteSignature,
  forgetRememberedSignature,
  isPersisted,
  isVaultAvailable,
  listSignatures,
  normalizeName,
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
    vi.restoreAllMocks()
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

  it('remembers only a browser-local key and restores the signature without the PIN', async () => {
    const saved = await saveSignature({ name: '全名', image, pin: 'abc123' })

    await rememberSignatureKey(saved, 'abc123')
    closeVault()

    const [reloaded] = await listSignatures()
    expect(await readRememberedSignature(reloaded!)).toEqual(png)
    expect(JSON.stringify(await rawRecords())).not.toContain('abc123')

    await forgetRememberedSignature(saved.id)
    expect(await readRememberedSignature(reloaded!)).toBeNull()
  })

  it('upgrades a version 2 database without losing signatures or remembered legacy keys', async () => {
    const encrypted = await encryptImage(png, 'abc123')
    const plain: StoredSignature = { id: 'plain-v2', name: '明文', createdAt: 1, naturalWidth: 300, naturalHeight: 100, encrypted: false, pngBytes: png }
    const protectedEntry: StoredSignature = { id: 'protected-v2', name: '旧加密', createdAt: 2, naturalWidth: 300, naturalHeight: 100, encrypted: true, ...encrypted }
    const remembered = await deriveDecryptionKey('abc123', encrypted.salt, encrypted.kdfIterations)
    const legacy = await openDB('inksign', 2, {
      upgrade(db) {
        db.createObjectStore('signatures', { keyPath: 'id' })
        db.createObjectStore('remembered-keys')
      },
    })
    await legacy.put('signatures', plain)
    await legacy.put('signatures', protectedEntry)
    await legacy.put('remembered-keys', remembered, protectedEntry.id)
    legacy.close()

    expect(await listSignatures()).toEqual([plain, protectedEntry])
    expect(await readLibrarySettings()).toEqual({ autoSave: false, rememberUnlock: false, pin: null, revision: 0 })
    expect(await readRememberedSignature(protectedEntry)).toEqual(png)
    expect(await readSignature(protectedEntry, 'abc123')).toEqual(png)
    const upgraded = await openDB('inksign')
    expect(upgraded.version).toBe(3)
    expect(upgraded.objectStoreNames.contains('settings')).toBe(true)
    upgraded.close()
  })

  it('uses one non-extractable library key while giving every signature its own IV', async () => {
    const first = await saveSignature({ name: '甲', image })
    const second = await saveSignature({ name: '乙', image })
    const settings = await updateLibraryPreferences({ rememberUnlock: true })
    const result = await changeLibraryPin(settings, [first, second], new Map([[first.id, png], [second.id, png]]), 'abc123')

    expect(result.key?.extractable).toBe(false)
    expect(result.entries[0]!.iv).not.toEqual(result.entries[1]!.iv)
    expect((await readRememberedLibraryKey())?.extractable).toBe(false)
    const key = await unlockLibraryKey(await readLibrarySettings(), 'abc123')
    for (const entry of await rawRecords()) {
      expect(entry).toMatchObject({ encrypted: true, protection: 'library' })
      expect(entry.pngBytes).toBeUndefined()
      expect(entry.salt).toBeUndefined()
      expect(await readLibrarySignature(entry, key)).toEqual(png)
    }
    expect(JSON.stringify(await readLibrarySettings())).not.toContain('abc123')
  })

  it('rejects stale saves and migrations after another connection updates settings', async () => {
    const entry = await saveSignature({ name: '原签名', image })
    const stale = await readLibrarySettings()
    await updateLibraryPreferences({ rememberUnlock: true })
    const latest = await readLibrarySettings()

    expect(await errorCode(saveSignature({ name: '过期保存', image, settingsRevision: stale.revision }))).toBe('changed')
    expect(await errorCode(changeLibraryPin(stale, [entry], new Map([[entry.id, png]]), 'abc123'))).toBe('changed')
    expect(await rawRecords()).toEqual([entry])
    expect(await readLibrarySettings()).toEqual(latest)
  })

  it('rejects stale preference writes without overwriting newer settings', async () => {
    const initial = await readLibrarySettings()
    const latest = await updateLibraryPreferences({ autoSave: true }, initial.revision)

    expect(await errorCode(updateLibraryPreferences({ autoSave: false, rememberUnlock: true }, initial.revision))).toBe('changed')
    expect(await readLibrarySettings()).toEqual(latest)
    expect(await readRememberedLibraryKey()).toBeUndefined()
  })

  it('rolls back preferences and preserves remembered keys when clearing them throws synchronously', async () => {
    const entry = await saveSignature({ name: '全名', image })
    const settings = await updateLibraryPreferences({ autoSave: true, rememberUnlock: true })
    const initial = await changeLibraryPin(settings, [entry], new Map([[entry.id, png]]), 'abc123')
    const clear = IDBObjectStore.prototype.clear
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (this.name === 'remembered-keys')
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return clear.call(this)
    })

    expect(await errorCode(updateLibraryPreferences({ autoSave: false, rememberUnlock: false }, initial.settings.revision))).toBe('quota')
    expect(await readLibrarySettings()).toEqual(initial.settings)
    expect(await rawRecords()).toEqual(initial.entries)
    const remembered = await readRememberedLibraryKey()
    expect(remembered?.extractable).toBe(false)
    expect(await readLibrarySignature(initial.entries[0]!, remembered!)).toEqual(png)
  })

  it('refuses remembered keys after remembering is disabled or the library PIN is removed', async () => {
    const settings = await updateLibraryPreferences({ rememberUnlock: true })
    const protectedLibrary = await changeLibraryPin(settings, [], new Map(), 'abc123')
    const disabled = await updateLibraryPreferences({ rememberUnlock: false }, protectedLibrary.settings.revision)

    expect(await errorCode(rememberLibraryKey(protectedLibrary.key!, disabled.revision))).toBe('changed')
    expect(await readRememberedLibraryKey()).toBeUndefined()

    const enabled = await updateLibraryPreferences({ rememberUnlock: true }, disabled.revision)
    await rememberLibraryKey(protectedLibrary.key!, enabled.revision)
    expect(await readRememberedLibraryKey()).toBeDefined()
    const removed = await changeLibraryPin(enabled, [], new Map(), null)
    expect(await errorCode(rememberLibraryKey(protectedLibrary.key!, removed.settings.revision))).toBe('changed')
    expect(await readRememberedLibraryKey()).toBeUndefined()
  })

  it('prevents a stale unlock from replacing the remembered key after a PIN migration', async () => {
    const entry = await saveSignature({ name: '全名', image })
    const settings = await updateLibraryPreferences({ rememberUnlock: true })
    const first = await changeLibraryPin(settings, [entry], new Map([[entry.id, png]]), 'first1')
    const second = await changeLibraryPin(first.settings, first.entries, new Map([[entry.id, png]]), 'second2')

    expect(await errorCode(rememberLibraryKey(first.key!, first.settings.revision))).toBe('changed')
    const remembered = await readRememberedLibraryKey()
    expect(remembered?.extractable).toBe(false)
    expect(await readLibrarySignature(second.entries[0]!, remembered!)).toEqual(png)
  })

  it('rolls back PIN migration if writing its remembered key throws', async () => {
    const entry = await saveSignature({ name: '全名', image })
    const settings = await updateLibraryPreferences({ rememberUnlock: true })
    const initial = await changeLibraryPin(settings, [entry], new Map([[entry.id, png]]), 'first1')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'remembered-keys' && key === 'library')
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    })

    expect(await errorCode(changeLibraryPin(initial.settings, initial.entries, new Map([[entry.id, png]]), 'second2'))).toBe('quota')
    expect(await rawRecords()).toEqual(initial.entries)
    expect(await readLibrarySettings()).toEqual(initial.settings)
    expect(await readLibrarySignature(initial.entries[0]!, (await readRememberedLibraryKey())!)).toEqual(png)
    expect(await readSignature(initial.entries[0]!, 'first1')).toEqual(png)
  })

  it('rejects a migration if signatures were added after its snapshot', async () => {
    const first = await saveSignature({ name: '甲', image })
    const settings = await readLibrarySettings()
    const second = await saveSignature({ name: '乙', image })

    expect(await errorCode(changeLibraryPin(settings, [first], new Map([[first.id, png]]), 'abc123'))).toBe('changed')
    expect(await rawRecords()).toEqual(expect.arrayContaining([first, second]))
    expect(await readLibrarySettings()).toEqual(settings)
  })

  it('refuses plaintext saves when the library requires an unlocked key', async () => {
    const settings = await readLibrarySettings()
    const result = await changeLibraryPin(settings, [], new Map(), 'abc123')

    expect(await errorCode(saveSignature({ name: '未解锁', image, settingsRevision: result.settings.revision }))).toBe('locked')
    expect(await rawRecords()).toEqual([])

    const saved = await saveSignature({ name: '已解锁', image, key: result.key!, settingsRevision: result.settings.revision })
    expect(saved.protection).toBe('library')
    expect(await readSignature(saved, 'abc123')).toEqual(png)
  })

  it('rolls back every migrated entry, settings and remembered keys when the transaction aborts', async () => {
    const first = await saveSignature({ name: '甲', image, pin: 'first1' })
    const second = await saveSignature({ name: '乙', image })
    await rememberSignatureKey(first, 'first1')
    const settings = await readLibrarySettings()
    const clear = IDBObjectStore.prototype.clear
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      const request = clear.call(this)
      if (this.name === 'remembered-keys')
        this.transaction.abort()
      return request
    })

    expect(await errorCode(changeLibraryPin(settings, [first, second], new Map([[first.id, png], [second.id, png]]), 'unified3'))).toBe('failed')
    expect(await rawRecords()).toEqual(expect.arrayContaining([first, second]))
    expect(await rawRecords()).toHaveLength(2)
    expect(await readLibrarySettings()).toEqual(settings)
    expect(await readRememberedSignature(first)).toEqual(png)
  })

  it('leaves no partial migration when queuing the settings write throws', async () => {
    const first = await saveSignature({ name: '甲', image })
    const second = await saveSignature({ name: '乙', image })
    const settings = await readLibrarySettings()
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'settings')
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    })

    expect(await errorCode(changeLibraryPin(settings, [first, second], new Map([[first.id, png], [second.id, png]]), 'abc123'))).toBe('quota')
    expect.soft(await rawRecords()).toEqual(expect.arrayContaining([first, second]))
    expect.soft(await readLibrarySettings()).toEqual(settings)
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
