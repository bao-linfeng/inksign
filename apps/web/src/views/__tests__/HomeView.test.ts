// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import HomeView from '../HomeView.vue'

describe('homeView', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('states the privacy promise and the visual-signature boundary', () => {
    const wrapper = mount(HomeView)

    expect(wrapper.text()).toContain('文件在本地处理')
    expect(wrapper.text()).toContain('不等同于证书数字签名')
  })

  it('emits the chosen file and resets the input', async () => {
    const wrapper = mount(HomeView)
    const input = wrapper.get('input[type="file"]')
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })

    await input.trigger('change')

    expect(wrapper.emitted('select')).toEqual([[file]])
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('disables the button while a file is being opened', () => {
    const wrapper = mount(HomeView, { props: { loading: true } })

    expect(wrapper.findAll('button').find(button => button.text().includes('正在打开'))!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('正在打开')
  })

  it('shows why the last file failed, so the user can pick another', () => {
    const wrapper = mount(HomeView, { props: { error: '请选择 PDF 格式文件。' } })

    expect(wrapper.get('[role="alert"]').text()).toBe('请选择 PDF 格式文件。')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('invites dropping while a file is dragged over the window', () => {
    expect(mount(HomeView).text()).toContain('或将 PDF 拖到此处')
    expect(mount(HomeView, { props: { dragging: true } }).text()).toContain('松开即可打开')
  })
})
