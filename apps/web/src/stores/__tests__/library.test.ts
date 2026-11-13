import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WrongPinError } from '@/services/signature-crypto'
import { closeVault, listSignatures, saveSignature, VaultError } from '@/services/signature-vault'

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

  it('treats a signature saved with a PIN as unlocked for the session', async () => {
    const library = useLibraryStore()

    const entry = await library.save('全名', image, 'abc123')

    expect(entry.encrypted).toBe(true)
    expect(library.isLocked(entry)).toBe(false)
    expect(library.bytesOf(entry.id)).toEqual(png)
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

    library.lock()
    expect(library.bytesOf(id)).toBeNull()
    expect(library.previews.has(id)).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('changes and removes a PIN', async () => {
    const library = useLibraryStore()
    const { id } = await library.save('全名', image)

    await library.changePin(id, undefined, 'abc123')
    expect(library.entries[0]).toMatchObject({ encrypted: true })
    expect(library.bytesOf(id)).toEqual(png)

    library.lock()
    await expect(library.changePin(id, 'nope00', null)).rejects.toBeInstanceOf(WrongPinError)
    await library.changePin(id, 'abc123', null)
    expect(library.entries[0]).toMatchObject({ encrypted: false, pngBytes: png })
    expect(library.hasUnlocked).toBe(false)
  })

  it('locks encrypted session copies and placements, but keeps unprotected ones', async () => {
    const library = useLibraryStore()
    const signing = useSigningStore()
    const protectedEntry = await library.save('保护', image, 'abc123')
    const plainEntry = await library.save('普通', image)
    const protectedSource = signing.addFromLibrary(protectedEntry.id, image)
    const plainSource = signing.addFromLibrary(plainEntry.id, image)
    const rect = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.1 }
    signing.placeSource(plainSource.id, 0, rect)
    signing.placeSource(protectedSource.id, 0, rect)
    signing.arm(protectedSource.id)

    library.lock()

    expect(signing.sources.map(source => source.id)).toEqual([plainSource.id])
    expect(signing.placements.map(placement => placement.sourceId)).toEqual([plainSource.id])
    expect(signing.armedSourceId).toBeNull()
    expect(library.bytesOf(protectedEntry.id)).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(protectedSource.previewUrl)
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
