// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { downloadBytes } from '@/services/download'
import { closeVault, listSignatures, saveSignature } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'

import SignatureDialog from '../SignatureDialog.vue'
import 'fake-indexeddb/auto'

vi.mock('@/services/download', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/download')>(),
  downloadBytes: vi.fn(),
}))

const image = { pngBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1]), width: 300, height: 100 }
const DrawPad = defineComponent({
  props: { expanded: Boolean },
  emits: ['change', 'update:expanded'],
  setup(props, { emit, expose }) {
    expose({ toImage: async () => image })
    return () => h('div', [
      h('button', { onClick: () => emit('change', false) }, '模拟手写'),
      h('button', { onClick: () => emit('update:expanded', !props.expanded) }, props.expanded ? '完成书写' : '全屏书写'),
    ])
  },
})

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

async function mountDialog(saveOnly = false) {
  const wrapper = mount(SignatureDialog, {
    props: { open: true, saveOnly },
    attachTo: document.body,
    global: { stubs: { SignatureDrawPad: DrawPad, SignatureUpload: true } },
  })
  await vi.waitFor(() => expect(useLibraryStore().status).toBe('ready'))
  await flushPromises()
  return wrapper
}

describe('signatureDialog library flow', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    closeVault()
    vi.stubGlobal('indexedDB', new IDBFactory())
    setActivePinia(createPinia())
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:signature')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.mocked(downloadBytes).mockReset()
  })

  afterEach(() => {
    closeVault()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps a new signature in memory by default without saving or PIN controls', async () => {
    const wrapper = await mountDialog()
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull()
    expect(document.body.querySelector('input[type="password"]')).toBeNull()
    expect(document.body.querySelector('#signature-name')).toBeNull()
    expect(document.body.textContent).not.toContain('保存到本设备')
    await click('模拟手写')
    await click('使用此签名')

    expect(wrapper.emitted('create')).toEqual([['draw', image, undefined]])
    expect(await listSignatures()).toEqual([])
  })

  it('requires first-save consent, then persists ciphertext and returns its library id', async () => {
    const library = useLibraryStore()
    await library.preferences({ autoSave: true })
    await library.setPin('', 'secret1')
    const wrapper = await mountDialog()
    await click('模拟手写')
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull()
    expect(document.body.querySelector('input[type="password"]')).toBeNull()
    await click('保存并使用')

    expect(document.body.textContent).toContain('不具备证书数字签名的防篡改与身份认证能力')
    expect(await listSignatures()).toEqual([])
    expect(wrapper.emitted('create')).toBeUndefined()
    await click('了解并保存')
    await vi.waitFor(() => expect(wrapper.emitted('create')).toHaveLength(1))

    const [entry] = await listSignatures()
    expect(entry).toMatchObject({ encrypted: true, protection: 'library', name: '全名' })
    expect(entry!.pngBytes).toBeUndefined()
    expect(wrapper.emitted('create')![0]![2]).toBe(entry!.id)
  })

  it('keeps the same drawing mounted through expanded mode and exports after returning', async () => {
    const wrapper = await mountDialog()
    const pad = wrapper.findComponent(DrawPad).vm.$
    await click('模拟手写')
    await click('全屏书写')
    const dialog = document.body.querySelector('.signature-dialog-expanded')!
    expect(dialog).not.toBeNull()
    expect(dialog.classList.contains('translate-x-0')).toBe(true)
    expect(dialog.classList.contains('translate-y-0')).toBe(true)
    expect(dialog.classList.contains('translate-x-[-50%]')).toBe(false)
    expect(dialog.classList.contains('translate-y-[-50%]')).toBe(false)
    expect(button('使用此签名').closest<HTMLElement>('[data-slot="dialog-footer"]')!.style.display).toBe('none')
    await click('完成书写')
    expect(wrapper.findComponent(DrawPad).vm.$).toBe(pad)
    expect(document.body.querySelector('.signature-dialog-expanded')).toBeNull()
    expect(dialog.classList.contains('translate-x-[-50%]')).toBe(true)
    expect(dialog.classList.contains('translate-y-[-50%]')).toBe(true)
    await click('下载 PNG')
    expect(downloadBytes).toHaveBeenCalledWith(image.pngBytes, '签名_全名.png', 'image/png')
    await click('使用此签名')
    expect(wrapper.emitted('create')).toEqual([['draw', image, undefined]])
  })

  it('returns from expanded mode on Escape before closing the dialog', async () => {
    const wrapper = await mountDialog()
    await click('全屏书写')
    button('完成书写').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.querySelector('.signature-dialog-expanded')).toBeNull()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('defaults to the library and selects a previously saved signature', async () => {
    const entry = await saveSignature({ name: '已有签名', image })
    const wrapper = await mountDialog()
    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')
    document.body.querySelector<HTMLButtonElement>('[aria-label="使用签名：已有签名"]')!.click()
    await flushPromises()

    expect(wrapper.emitted('create')).toEqual([['image', image, entry.id]])
  })

  it('rejects a wrong PIN and unlocks the entire library once for download and reuse', async () => {
    const library = useLibraryStore()
    await library.setPin('', 'secret1')
    const first = await library.save('全名', image)
    const second = await library.save('简签', image)
    await library.lock()
    const wrapper = await mountDialog()
    const card = document.body.querySelector<HTMLButtonElement>('[aria-label="解锁签名：全名"]')!.closest('li')!
    const download = [...card.querySelectorAll('button')].find(el => el.textContent?.trim() === '下载 PNG 备份')!
    download.click()
    await flushPromises()
    await input('pin-current', 'wrong1')
    await click('解锁')
    await vi.waitFor(() => expect(document.body.textContent).toContain('PIN 不正确'))
    expect(downloadBytes).not.toHaveBeenCalled()
    await input('pin-current', 'secret1')
    await click('解锁')
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledWith(image.pngBytes, '签名_全名.png', 'image/png'))
    expect(library.bytesOf(first.id)).toEqual(image.pngBytes)
    expect(library.bytesOf(second.id)).toEqual(image.pngBytes)
    expect(document.body.querySelector('#pin-current')).toBeNull()
    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')
    document.body.querySelector<HTMLButtonElement>('[aria-label="使用签名：简签"]')!.click()
    await flushPromises()
    expect(document.body.querySelector('#pin-current')).toBeNull()
    expect(wrapper.emitted('create')).toEqual([['image', image, second.id]])
  })

  it('continues automatic saving only after unlocking the library', async () => {
    const library = useLibraryStore()
    await library.preferences({ autoSave: true })
    await library.setPin('', 'secret1')
    const existing = await library.save('已有签名', image)
    await library.lock()
    const wrapper = await mountDialog()
    await click('手写')
    await click('模拟手写')
    await click('保存并使用')

    expect(document.body.querySelector('#pin-current')).not.toBeNull()
    expect(await listSignatures()).toHaveLength(1)
    expect(wrapper.emitted('create')).toBeUndefined()
    await input('pin-current', 'secret1')
    await click('解锁')
    await vi.waitFor(() => expect(wrapper.emitted('create')).toHaveLength(1))

    const entries = await listSignatures()
    const saved = entries.find(entry => entry.id !== existing.id)!
    expect(saved).toMatchObject({ name: '全名', encrypted: true, protection: 'library' })
    expect(saved.pngBytes).toBeUndefined()
    expect(wrapper.emitted('create')).toEqual([['draw', image, saved.id]])
  })

  it('still unlocks a legacy signature through its original PIN', async () => {
    const entry = await saveSignature({ name: '旧版签名', image, pin: 'legacy1' })
    const wrapper = await mountDialog()
    await click('输入 PIN 使用')
    expect(document.body.textContent).toContain('解锁旧版签名“旧版签名”')
    await input('pin-current', 'legacy1')
    await click('解锁')
    await vi.waitFor(() => expect(wrapper.emitted('create')).toEqual([['image', image, entry.id]]))
  })

  it('creates a saved signature from the home library without needing a PDF', async () => {
    const wrapper = await mountDialog(true)
    await click('新建签名')
    await click('模拟手写')
    expect(useLibraryStore().settings.autoSave).toBe(false)
    expect(button('保存签名').disabled).toBe(false)
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull()
    await click('保存签名')
    expect(await listSignatures()).toEqual([])
    expect(document.body.textContent).toContain('不具备证书数字签名的防篡改与身份认证能力')
    await click('了解并保存')
    await vi.waitFor(() => expect(useLibraryStore().entries).toHaveLength(1))
    await flushPromises()

    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('only exposes use, download, rename and delete actions for saved signatures', async () => {
    const library = useLibraryStore()
    await library.save('旧名称', image)
    await library.setPin('', 'secret1')
    await mountDialog(true)
    const labels = [...document.body.querySelectorAll('button')].map(el => el.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['下载 PNG 备份', '重命名', '删除']))
    for (const label of ['设置 PIN', '修改 PIN', '移除 PIN', '锁定', '清空全部', '清空全部签名'])
      expect(labels).not.toContain(label)
    expect(document.body.querySelector('input[type="password"]')).toBeNull()
    await click('重命名')
    await input('signature-rename', '新名称')
    await click('保存名称')
    await vi.waitFor(() => expect(useLibraryStore().entries[0]!.name).toBe('新名称'))
    await flushPromises()
    await click('删除')
    expect(await listSignatures()).toHaveLength(1)
    await click('确认删除')
    await vi.waitFor(() => expect(useLibraryStore().entries).toEqual([]))
    expect(await listSignatures()).toEqual([])
    expect(document.body.textContent).toContain('还没有保存的签名')
  })
})
