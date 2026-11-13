// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { downloadBytes } from '@/services/download'
import { closeVault, listSignatures, saveSignature } from '@/services/signature-vault'
import { useLibraryStore } from '@/stores/library'
import { useSigningStore } from '@/stores/signing'

import SignatureDialog from '../SignatureDialog.vue'
import 'fake-indexeddb/auto'

vi.mock('@/services/download', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/download')>(),
  downloadBytes: vi.fn(),
}))

const image = { pngBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1]), width: 300, height: 100 }
const DrawPad = defineComponent({
  emits: ['change'],
  setup(_, { emit, expose }) {
    expose({ toImage: async () => image })
    return () => h('button', { onClick: () => emit('change', false) }, '模拟手写')
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

async function checkbox(label: string) {
  const el = [...document.body.querySelectorAll('label')].find(el => el.textContent?.includes(label))!
  el.querySelector<HTMLInputElement>('input')!.click()
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

  it('keeps a new signature in memory unless saving is explicitly selected', async () => {
    const wrapper = await mountDialog()
    expect(document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
    await click('模拟手写')
    await click('使用此签名')

    expect(wrapper.emitted('create')).toEqual([['draw', image, undefined]])
    expect(await listSignatures()).toEqual([])
  })

  it('requires first-save consent, then persists ciphertext and returns its library id', async () => {
    const wrapper = await mountDialog()
    await click('模拟手写')
    await checkbox('保存到本设备')
    await checkbox('使用 PIN 保护')
    await input('save-pin', 'secret1')
    await input('save-pin-repeat', 'different')
    expect(button('保存并使用').disabled).toBe(true)
    await input('save-pin-repeat', 'secret1')
    await click('保存并使用')

    expect(document.body.textContent).toContain('不具备证书数字签名的防篡改与身份认证能力')
    expect(await listSignatures()).toEqual([])
    expect(wrapper.emitted('create')).toBeUndefined()
    await click('了解并保存')
    await vi.waitFor(() => expect(wrapper.emitted('create')).toHaveLength(1))

    const [entry] = await listSignatures()
    expect(entry).toMatchObject({ encrypted: true, name: '全名' })
    expect(entry!.pngBytes).toBeUndefined()
    expect(wrapper.emitted('create')![0]![2]).toBe(entry!.id)
  })

  it('defaults to the library and selects a previously saved signature', async () => {
    const entry = await saveSignature({ name: '已有签名', image })
    const wrapper = await mountDialog()
    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')
    document.body.querySelector<HTMLButtonElement>('[aria-label="使用签名：已有签名"]')!.click()
    await flushPromises()

    expect(wrapper.emitted('create')).toEqual([['image', image, entry.id]])
  })

  it('rejects a wrong PIN, downloads after unlocking, then locks session placements', async () => {
    const entry = await saveSignature({ name: '全名', image, pin: 'secret1' })
    await mountDialog()
    await click('下载 PNG 备份')
    await input('pin-current', 'wrong1')
    await click('解锁')
    await vi.waitFor(() => expect(document.body.textContent).toContain('PIN 不正确'))
    expect(downloadBytes).not.toHaveBeenCalled()
    await input('pin-current', 'secret1')
    await click('解锁')
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledWith(image.pngBytes, '签名_全名.png', 'image/png'))
    expect(useLibraryStore().hasUnlocked).toBe(true)
    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')

    const signing = useSigningStore()
    const source = signing.addFromLibrary(entry.id, image)
    signing.placeSource(source.id, 0, { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 })
    await click('锁定')
    expect(signing.placements).toHaveLength(1)
    await click('锁定并移除放置')

    expect(signing.sources).toEqual([])
    expect(signing.placements).toEqual([])
    expect(useLibraryStore().bytesOf(entry.id)).toBeNull()
  })

  it('creates a saved signature from the home library without needing a PDF', async () => {
    const wrapper = await mountDialog(true)
    await click('新建签名')
    await click('模拟手写')
    expect(button('保存签名').disabled).toBe(true)
    await checkbox('保存到本设备')
    await click('保存签名')
    await click('了解并保存')
    await vi.waitFor(() => expect(useLibraryStore().entries).toHaveLength(1))
    await flushPromises()

    expect(document.body.querySelector('[role="tab"][data-state="active"]')!.textContent).toContain('我的签名')
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('renames and clears saved signatures through explicit confirmation', async () => {
    await saveSignature({ name: '旧名称', image })
    await mountDialog(true)
    await click('重命名')
    await input('signature-rename', '新名称')
    await click('保存名称')
    await vi.waitFor(() => expect(useLibraryStore().entries[0]!.name).toBe('新名称'))
    await flushPromises()
    await click('清空全部')
    expect(await listSignatures()).toHaveLength(1)
    await click('确认删除')
    await vi.waitFor(() => expect(useLibraryStore().entries).toEqual([]))
    expect(await listSignatures()).toEqual([])
    expect(document.body.textContent).toContain('还没有保存的签名')
  })
})
