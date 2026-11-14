import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WrongPinError } from '@/services/signature-crypto'
import { closeVault, listSignatures, readLibrarySettings, readRememberedLibraryKey, readRememberedSignature, readSignature, saveSignature, updateLibraryPreferences, VaultError } from '@/services/signature-vault'

import { useLibraryStore } from '../library'
import { useSigningStore } from '../signing'
// idb checks requests against the global IDB classes
import 'fake-indexeddb/auto'

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
const image = { pngBytes: png, width: 300, height: 100 }

describe('library store', () => {
  let urls: number

  beforeEach(() => {
    closeVault()
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('navigator', { storage: { persist: vi.fn(async () => true), persisted: vi.fn(async () => false) } })
    setActivePinia(createPinia())
    urls = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    closeVault()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads what was saved before, with previews of the plain entries', async () => {
    await saveSignature({ name: '全名', image })
    await saveSignature({ name: '简签', image, pin: 'abc123' })
    const library = useLibraryStore()

    await library.load()

    expect(library.status).toBe('ready')
    expect(library.entries.map(e => e.name)).toEqual(['全名', '简签'])
    const [plain, locked] = library.entries
    expect(library.previews.get(plain!.id)).toMatch(/^blob:/)
    expect(library.previews.has(locked!.id)).toBe(false)
    expect(library.isLocked(locked!)).toBe(true)
    expect(library.bytesOf(plain!.id)).toEqual(png)
    expect(library.persisted).toBe(false)
  })

  it('asks for persistent storage on save (PRD FR-08)', async () => {
    const library = useLibraryStore()

    const entry = await library.save('全名', image)

    expect(navigator.storage.persist).toHaveBeenCalledOnce()
    expect(library.persisted).toBe(true)
    expect(library.entries).toEqual([entry])
    expect(await listSignatures()).toEqual([entry])
  })

  it('encrypts existing signatures together and uses the library PIN for new signatures', async () => {
    const library = useLibraryStore()
    const first = await library.save('全名', image)
    const secondPng = new Uint8Array([...png, 4, 5, 6])
    const second = await library.save('简签', { ...image, pngBytes: secondPng })

    await library.setPin('', 'abc123')
    const entry = await library.save('新签名', image)

    expect(library.pinEnabled).toBe(true)
    expect(library.locked).toBe(false)
    expect(library.entries.map(saved => saved.id)).toEqual([first.id, second.id, entry.id])
    for (const saved of await listSignatures()) {
      const expected = saved.id === second.id ? secondPng : png
      expect(saved).toMatchObject({ encrypted: true, protection: 'library' })
      expect(saved.pngBytes).toBeUndefined()
      expect(await readSignature(saved, 'abc123')).toEqual(expected)
      expect(library.isLocked(saved)).toBe(false)
      expect(library.bytesOf(saved.id)).toEqual(expected)
    }
    expect(library.hasUnlocked).toBe(true)
  })

  it('unlocks with the right PIN only, until the library is locked again (PRD FR-08)', async () => {
    const { id } = await saveSignature({ name: '全名', image, pin: 'abc123' })
    const library = useLibraryStore()
    await library.load()

    await expect(library.unlock(id, 'abc124')).rejects.toBeInstanceOf(WrongPinError)
    expect(library.bytesOf(id)).toBeNull()

    expect(await library.unlock(id, 'abc123')).toEqual(png)
    expect(library.bytesOf(id)).toEqual(png)
    const url = library.previews.get(id)
    expect(url).toMatch(/^blob:/)

    await library.lock()
    expect(library.bytesOf(id)).toBeNull()
    expect(library.previews.has(id)).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('checks the current PIN before changing or removing protection for all entries', async () => {
    const library = useLibraryStore()
    const { id } = await library.save('全名', image)
    await library.save('简签', image)

    await library.setPin('', 'abc123')
    expect(library.bytesOf(id)).toEqual(png)
    const before = await listSignatures()
    const settingsBefore = await readLibrarySettings()

    await expect(library.setPin('nope00', 'second2')).rejects.toBeInstanceOf(WrongPinError)
    await expect(library.setPin('nope00', null)).rejects.toBeInstanceOf(WrongPinError)
    expect(await listSignatures()).toEqual(before)
    expect(await readLibrarySettings()).toEqual(settingsBefore)
    expect(library.entries).toEqual(expect.arrayContaining(before))
    expect(library.entries).toHaveLength(before.length)

    await library.setPin('abc123', 'second2')
    await library.lock()
    await expect(library.unlockVault('abc123')).rejects.toBeInstanceOf(WrongPinError)
    expect(library.locked).toBe(true)
    expect(library.hasUnlocked).toBe(false)
    await library.unlockVault('second2')
    expect(library.entries.every(entry => !library.isLocked(entry))).toBe(true)

    await library.setPin('second2', null)
    expect(library.pinEnabled).toBe(false)
    expect(library.locked).toBe(false)
    for (const entry of await listSignatures()) {
      expect(entry).toMatchObject({ encrypted: false, pngBytes: png })
      expect(entry.cipher).toBeUndefined()
      expect(entry.protection).toBeUndefined()
    }
    expect(library.hasUnlocked).toBe(false)
    expect(await readRememberedLibraryKey()).toBeUndefined()
    closeVault()
    setActivePinia(createPinia())
    const refreshed = useLibraryStore()
    await refreshed.load()
    expect(refreshed.bytesOf(id)).toEqual(png)
    expect(refreshed.pinEnabled).toBe(false)
  })

  it('locks encrypted session copies and placements, but keeps unprotected ones', async () => {
    const library = useLibraryStore()
    const signing = useSigningStore()
    const protectedEntry = await saveSignature({ name: '保护', image, pin: 'abc123' })
    const plainEntry = await library.save('普通', image)
    await library.unlock(protectedEntry.id, 'abc123')
    const protectedSource = signing.addFromLibrary(protectedEntry.id, image)
    const plainSource = signing.addFromLibrary(plainEntry.id, image)
    const rect = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.1 }
    signing.placeSource(plainSource.id, 0, rect)
    signing.placeSource(protectedSource.id, 0, rect)
    signing.arm(protectedSource.id)

    await library.lock()

    expect(signing.sources.map(source => source.id)).toEqual([plainSource.id])
    expect(signing.placements.map(placement => placement.sourceId)).toEqual([plainSource.id])
    expect(signing.armedSourceId).toBeNull()
    expect(library.bytesOf(protectedEntry.id)).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(protectedSource.previewUrl)
  })

  it.each([false, true])('restores the whole library after refresh only when rememberUnlock is %s', async (rememberUnlock) => {
    const library = useLibraryStore()
    const first = await library.save('全名', image)
    const second = await library.save('简签', image)
    await library.preferences({ autoSave: true, rememberUnlock })
    await library.setPin('', 'abc123')
    await library.lock()
    await library.unlockVault('abc123')

    const key = await readRememberedLibraryKey()
    if (rememberUnlock) {
      expect(key?.extractable).toBe(false)
      expect(key?.usages).toEqual(['encrypt', 'decrypt'])
    }
    else {
      expect(key).toBeUndefined()
    }

    closeVault()
    setActivePinia(createPinia())
    const refreshed = useLibraryStore()
    await refreshed.load()
    expect(refreshed.settings).toMatchObject({ autoSave: true, rememberUnlock })
    expect(refreshed.locked).toBe(!rememberUnlock)
    expect(refreshed.bytesOf(first.id)).toEqual(rememberUnlock ? png : null)
    expect(refreshed.bytesOf(second.id)).toEqual(rememberUnlock ? png : null)
    expect(refreshed.previews.size).toBe(rememberUnlock ? 2 : 0)
    if (!rememberUnlock) {
      await expect(refreshed.save('锁定时保存', image)).rejects.toMatchObject({ code: 'locked' })
      expect(await listSignatures()).toHaveLength(2)
    }
  })

  it('forgets remembered keys on explicit lock and when remembering is disabled', async () => {
    const library = useLibraryStore()
    const { id } = await library.save('全名', image)
    await library.setPin('', 'abc123')
    await library.preferences({ rememberUnlock: true })
    expect(await readRememberedLibraryKey()).toBeDefined()

    await library.preferences({ rememberUnlock: false })
    expect(await readRememberedLibraryKey()).toBeUndefined()
    expect(library.bytesOf(id)).toEqual(png)
    await library.preferences({ rememberUnlock: true })
    await library.lock()
    expect(await readRememberedLibraryKey()).toBeUndefined()
    expect(library.locked).toBe(true)
    expect(library.bytesOf(id)).toBeNull()

    closeVault()
    setActivePinia(createPinia())
    const refreshed = useLibraryStore()
    await refreshed.load()
    expect(refreshed.locked).toBe(true)
    expect(refreshed.bytesOf(id)).toBeNull()
  })

  it.each([false, true])('uses settings to remember legacy unlocks when rememberUnlock is %s', async (rememberUnlock) => {
    const entry = await saveSignature({ name: '旧签名', image, pin: 'abc123' })
    const library = useLibraryStore()
    await library.preferences({ rememberUnlock })
    await library.unlock(entry.id, 'abc123')
    expect(await readRememberedSignature(entry)).toEqual(rememberUnlock ? png : null)

    closeVault()
    setActivePinia(createPinia())
    const refreshed = useLibraryStore()
    await refreshed.load()
    expect(refreshed.bytesOf(entry.id)).toEqual(rememberUnlock ? png : null)
  })

  it('requires each differently protected legacy signature to be unlocked before migrating all entries', async () => {
    const first = await saveSignature({ name: '旧甲', image, pin: 'first1' })
    const second = await saveSignature({ name: '旧乙', image, pin: 'second2' })
    await saveSignature({ name: '明文', image })
    const library = useLibraryStore()
    await library.load()
    await library.preferences({ rememberUnlock: true })
    const before = await listSignatures()

    await expect(library.setPin('', 'unified3')).rejects.toMatchObject({ code: 'legacy-locked' })
    await library.unlock(first.id, 'first1')
    await expect(library.unlock(second.id, 'first1')).rejects.toBeInstanceOf(WrongPinError)
    await expect(library.setPin('', 'unified3')).rejects.toMatchObject({ code: 'legacy-locked' })
    expect(await listSignatures()).toEqual(before)
    expect((await readLibrarySettings()).pin).toBeNull()

    await library.unlock(second.id, 'second2')
    expect(await readRememberedSignature(first)).toEqual(png)
    expect(await readRememberedSignature(second)).toEqual(png)
    await library.setPin('', 'unified3')
    expect(library.legacyEntries).toEqual([])
    expect(await readRememberedSignature(first)).toBeNull()
    expect(await readRememberedSignature(second)).toBeNull()
    const migrated = await listSignatures()
    expect(migrated).toHaveLength(3)
    for (const entry of migrated) {
      expect(entry.protection).toBe('library')
      expect(await readSignature(entry, 'unified3')).toEqual(png)
      expect(await readRememberedSignature(entry)).toBeNull()
    }
    await library.lock()
    await library.unlockVault('unified3')
    expect(library.entries.every(entry => !library.isLocked(entry))).toBe(true)
  })

  it('rejects saves and PIN migrations from a stale settings revision without changing data', async () => {
    const library = useLibraryStore()
    await library.save('原签名', image)
    const before = await listSignatures()
    await updateLibraryPreferences({ autoSave: true })
    const settings = await readLibrarySettings()

    await expect(library.save('过期保存', image)).rejects.toMatchObject({ code: 'changed' })
    await expect(library.setPin('', 'abc123')).rejects.toMatchObject({ code: 'changed' })
    await expect(library.preferences({ autoSave: false })).rejects.toMatchObject({ code: 'changed' })
    expect(await listSignatures()).toEqual(before)
    expect(await readLibrarySettings()).toEqual(settings)
    expect(library.entries).toEqual(before)
    expect(library.pinEnabled).toBe(false)
  })

  it('deletes saved signatures together with their session copies', async () => {
    const library = useLibraryStore()
    const signing = useSigningStore()
    const a = await library.save('a', image)
    const b = await library.save('b', image)
    signing.addFromLibrary(a.id, image)
    signing.addFromLibrary(b.id, image)
    const temporary = signing.addSource('draw', image)

    await library.remove(a.id)
    expect(signing.sources.map(source => source.libraryId)).toEqual([b.id, undefined])
    await library.clear()
    expect(signing.sources.map(source => source.id)).toEqual([temporary.id])
  })

  it.each([false, true])('clears the library and permits a new PIN when initially locked is %s', async (locked) => {
    const library = useLibraryStore()
    await library.preferences({ autoSave: true, rememberUnlock: true })
    const old = await library.save('旧签名', image)
    await library.setPin('', 'forgot1')
    expect(await readRememberedLibraryKey()).toBeDefined()
    if (locked)
      await library.lock()
    expect(library.locked).toBe(locked)
    const before = await readLibrarySettings()

    await library.clear()

    expect(library.pinEnabled).toBe(false)
    expect(library.locked).toBe(false)
    expect(library.entries).toEqual([])
    expect(library.hasUnlocked).toBe(false)
    expect(library.bytesOf(old.id)).toBeNull()
    expect(library.previews.size).toBe(0)
    expect(await listSignatures()).toEqual([])
    expect(await readRememberedLibraryKey()).toBeUndefined()
    expect(library.settings).toEqual({ autoSave: true, rememberUnlock: true, pin: null, revision: before.revision + 1 })
    expect(await readLibrarySettings()).toEqual(library.settings)

    const fresh = await library.save('新签名', image)
    expect(fresh.encrypted).toBe(false)
    await library.setPin('', 'newpin2')
    expect(library.pinEnabled).toBe(true)
    const additional = await library.save('另一签名', image)
    expect(additional.protection).toBe('library')
    await library.lock()
    await expect(library.unlockVault('forgot1')).rejects.toBeInstanceOf(WrongPinError)
    await library.unlockVault('newpin2')
    expect(library.bytesOf(fresh.id)).toEqual(png)
    expect(library.bytesOf(additional.id)).toEqual(png)
    expect(await listSignatures()).toHaveLength(2)
  })

  it('renames, deletes and clears, freeing the previews', async () => {
    const library = useLibraryStore()
    const a = await library.save('a', image)
    const b = await library.save('b', image)

    await library.rename(a.id, '全名')
    expect(library.entries.map(e => e.name)).toEqual(['全名', 'b'])

    const urlOfB = library.previews.get(b.id)
    await library.remove(b.id)
    expect(library.entries.map(e => e.id)).toEqual([a.id])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urlOfB)

    await library.clear()
    expect(library.entries).toEqual([])
    expect(library.previews.size).toBe(0)
    expect(await listSignatures()).toEqual([])
  })

  it('reports a full library', async () => {
    const library = useLibraryStore()
    for (let i = 0; i < 20; i++)
      await library.save(`签名 ${i}`, image)

    expect(library.full).toBe(true)
    await expect(library.save('one more', image)).rejects.toMatchObject({ code: 'full' })
  })

  it('degrades when IndexedDB cannot be used (PRD §9)', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const library = useLibraryStore()

    await library.load()

    expect(library.status).toBe('unavailable')
    expect(library.available).toBe(false)
    expect(library.entries).toEqual([])
    await expect(library.save('全名', image)).rejects.toBeInstanceOf(VaultError)
  })
})
