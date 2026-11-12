// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import HomeView from '../HomeView.vue'

describe('homeView', () => {
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
})
