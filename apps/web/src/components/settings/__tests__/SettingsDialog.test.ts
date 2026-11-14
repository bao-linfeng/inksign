// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeVault, listSignatures, saveSignature } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'
import { useSigningStore } from '@/stores/signing'

import SettingsDialog from '../SettingsDialog.vue'
import 'fake-indexeddb/auto'

const image = { pngBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1]), width: 300, height: 100 }

function button(label: string) {
  const found = [...document.body.querySelectorAll('button')].find(el => el.textContent?.trim() === label)
  if (!found)
    throw new Error(`Button not found: ${label}`)
  return found
}

async function click(label: string) {
  const target = button(label)
  target.focus()
  target.click()
  await flushPromises()
}

async function input(id: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement>(`#${id}`)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

function checkbox(label: string) {
  const el = [...document.body.querySelectorAll('label')].find(el => el.textContent?.includes(label))!
  return el.querySelector<HTMLElement>('[role="checkbox"]')!
}

async function mountSettings() {
  const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
  await vi.waitFor(() => expect(useLibraryStore().status).toBe('ready'))
  await flushPromises()
  return wrapper
}

describe('settingsDialog library settings', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    closeVault()
    vi.stubGlobal('indexedDB', new IDBFactory())
    setActivePinia(createPinia())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    closeVault()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('persists preferences immediately and reads them in a new settings instance', async () => {
    const wrapper = await mountSettings()
    expect(checkbox('自动保存新签名').getAttribute('aria-checked')).toBe('false')
    expect(checkbox('在此浏览器记住解锁状态').getAttribute('aria-checked')).toBe('false')
    checkbox('自动保存新签名').click()
    await vi.waitFor(() => expect(useLibraryStore().settings.autoSave).toBe(true))
    await flushPromises()
    checkbox('在此浏览器记住解锁状态').click()
    await vi.waitFor(() => expect(useLibraryStore().settings.rememberUnlock).toBe(true))
    await flushPromises()
    expect(document.body.textContent).toContain('设置已保存')
    expect(await listSignatures()).toEqual([])
    wrapper.unmount()
    closeVault()
    setActivePinia(createPinia())

    await mountSettings()
    expect(useLibraryStore().settings).toMatchObject({ autoSave: true, rememberUnlock: true })
    expect(checkbox('自动保存新签名').getAttribute('aria-checked')).toBe('true')
    expect(checkbox('在此浏览器记住解锁状态').getAttribute('aria-checked')).toBe('true')

    checkbox('自动保存新签名').click()
    await vi.waitFor(() => expect(useLibraryStore().settings.autoSave).toBe(false))
  })

  it('sets, changes and removes one PIN for every signature through settings', async () => {
    await saveSignature({ name: '全名', image })
    await saveSignature({ name: '简签', image })
    await mountSettings()
    const library = useLibraryStore()

    await click('设置 PIN')
    await input('settings-new-pin', 'secret1')
    await input('settings-repeat-pin', 'different')
    expect(button('保存 PIN').disabled).toBe(true)
    expect(document.body.textContent).toContain('两次输入的 PIN 不一致')
    await input('settings-repeat-pin', 'secret1')
    await click('保存 PIN')
    await vi.waitFor(() => expect(library.pinEnabled).toBe(true))
    await flushPromises()
    expect((await listSignatures()).every(entry => entry.encrypted && entry.protection === 'library' && !entry.pngBytes)).toBe(true)

    await click('修改 PIN')
    await input('settings-current-pin', 'wrong1')
    await input('settings-new-pin', 'secret2')
    await input('settings-repeat-pin', 'secret2')
    await click('保存 PIN')
    await vi.waitFor(() => expect(document.body.textContent).toContain('PIN 不正确'))
    await input('settings-current-pin', 'secret1')
    await click('保存 PIN')
    await vi.waitFor(() => expect(document.body.querySelector('#settings-current-pin')).toBeNull())
    await library.lock()
    await expect(library.unlockVault('secret1')).rejects.toThrow()
    await library.unlockVault('secret2')
    expect(library.entries.every(entry => library.bytesOf(entry.id) !== null)).toBe(true)

    await click('移除 PIN')
    expect(document.body.textContent).toContain('全部签名将不再加密')
    expect(document.body.querySelector('#settings-new-pin')).toBeNull()
    await input('settings-current-pin', 'wrong1')
    await click('确认移除 PIN')
    await vi.waitFor(() => expect(document.body.textContent).toContain('PIN 不正确'))
    expect(library.pinEnabled).toBe(true)
    await input('settings-current-pin', 'secret2')
    await click('确认移除 PIN')
    await vi.waitFor(() => expect(library.pinEnabled).toBe(false))
    await flushPromises()
    const entries = await listSignatures()
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => !entry.encrypted)).toBe(true)
    for (const entry of entries)
      expect(entry.pngBytes).toEqual(image.pngBytes)
    expect(button('设置 PIN').disabled).toBe(false)
  })

  it('unlocks old signatures before migrating them to the unified PIN', async () => {
    const legacy = await saveSignature({ name: '旧版签名', image, pin: 'legacy1' })
    await mountSettings()
    const library = useLibraryStore()
    await click('设置 PIN')
    await input('settings-new-pin', 'secret1')
    await input('settings-repeat-pin', 'secret1')
    expect(button('保存 PIN').disabled).toBe(true)
    await click('解锁旧签名')
    await input('pin-current', 'legacy1')
    await click('解锁')
    await vi.waitFor(() => expect(document.body.textContent).toContain('可迁移'))
    await flushPromises()
    expect(button('保存 PIN').disabled).toBe(false)
    await click('保存 PIN')
    await vi.waitFor(() => expect(library.legacyEntries).toEqual([]))
    expect(await listSignatures()).toEqual([expect.objectContaining({ id: legacy.id, name: '旧版签名', encrypted: true, protection: 'library' })])
    await library.lock()
    await expect(library.unlockVault('legacy1')).rejects.toThrow()
    await library.unlockVault('secret1')
    expect(library.bytesOf(legacy.id)).toEqual(image.pngBytes)
  })

  it('requires confirmation in settings before locking and removing protected placements', async () => {
    const library = useLibraryStore()
    await library.setPin('', 'secret1')
    const entry = await library.save('全名', image)
    const signing = useSigningStore()
    const source = signing.addFromLibrary(entry.id, image)
    signing.placeSource(source.id, 0, { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 })
    await mountSettings()
    await click('锁定')
    expect(signing.placements).toHaveLength(1)
    expect(library.bytesOf(entry.id)).toEqual(image.pngBytes)
    expect(document.body.textContent).toContain('请先导出需要保留的内容')
    await click('锁定并移除放置')
    await vi.waitFor(() => expect(library.locked).toBe(true))
    expect(signing.sources).toEqual([])
    expect(signing.placements).toEqual([])
    expect(library.bytesOf(entry.id)).toBeNull()
    expect(await listSignatures()).toHaveLength(1)
    await flushPromises()
    await click('解锁签名库')
    await input('pin-current', 'secret1')
    await click('解锁')
    await vi.waitFor(() => expect(library.bytesOf(entry.id)).toEqual(image.pngBytes))
  })

  it('clears saved signatures and placements only after confirming in settings', async () => {
    const library = useLibraryStore()
    const entry = await library.save('全名', image)
    const signing = useSigningStore()
    const source = signing.addFromLibrary(entry.id, image)
    signing.placeSource(source.id, 0, { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 })
    await mountSettings()
    await click('清空全部签名')
    expect(await listSignatures()).toHaveLength(1)
    expect(signing.placements).toHaveLength(1)
    expect(document.body.textContent).toContain('放置')
    await click('确认删除')
    await vi.waitFor(() => expect(library.entries).toEqual([]))
    expect(await listSignatures()).toEqual([])
    expect(signing.sources).toEqual([])
    expect(signing.placements).toEqual([])
  })
})
