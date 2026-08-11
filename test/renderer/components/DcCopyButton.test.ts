import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DcCopyButton from '@dc-ui/components/button/DcCopyButton.vue'

const { copyMock } = vi.hoisted(() => ({
  copyMock: vi.fn()
}))

vi.mock('@vueuse/core', () => ({
  useClipboard: () => ({
    copy: copyMock
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon'],
    template: '<span :data-icon="icon"></span>'
  }
}))

describe('DcCopyButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    copyMock.mockReset()
    copyMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('renders label as visible fallback text', () => {
    const wrapper = mount(DcCopyButton, {
      props: {
        copyText: 'hello'
      },
      attrs: {
        label: 'Copy visible text'
      }
    })

    expect(wrapper.text()).toContain('Copy visible text')
  })

  it('copies copyText, emits copied, preserves focus, and resets the success state', async () => {
    const wrapper = mount(DcCopyButton, {
      props: {
        copyText: 'hello'
      },
      attrs: {
        label: 'Copy'
      },
      attachTo: document.body
    })

    const button = wrapper.get('button')
    button.element.focus()

    await button.trigger('click')

    await vi.waitFor(() => expect(copyMock).toHaveBeenCalledWith('hello'))
    await vi.waitFor(() => expect(wrapper.emitted('copied')).toHaveLength(1))
    expect(wrapper.find('[data-icon="lucide:check"]').exists()).toBe(true)
    expect(wrapper.get('button').classes()).toContain('text-emerald-600')
    expect(document.activeElement).toBe(button.element)

    await vi.advanceTimersByTimeAsync(1200)
    await nextTick()

    expect(wrapper.find('[data-icon="lucide:copy"]').exists()).toBe(true)
    expect(document.activeElement).toBe(button.element)
  })

  it('emits error when clipboard copying fails', async () => {
    const error = new Error('copy failed')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    copyMock.mockRejectedValueOnce(error)
    const wrapper = mount(DcCopyButton, {
      props: {
        copyText: 'hello'
      },
      attrs: {
        label: 'Copy'
      }
    })

    await wrapper.get('button').trigger('click')

    await vi.waitFor(() => expect(wrapper.emitted('error')?.[0]).toEqual([error]))
    expect(wrapper.emitted('copied')).toBeUndefined()
    expect(wrapper.find('[data-icon="lucide:copy"]').exists()).toBe(true)
    errorSpy.mockRestore()
  })

  it('preserves inherited click handlers and modifiers', async () => {
    const parentClick = vi.fn()
    const childClick = vi.fn()
    const Wrapper = defineComponent({
      components: { DcCopyButton },
      setup() {
        return { parentClick, childClick }
      },
      template:
        '<div @click="parentClick"><DcCopyButton copy-text="hello" label="Copy" @click.stop="childClick" /></div>'
    })
    const wrapper = mount(Wrapper)

    await wrapper.get('button').trigger('click')

    await vi.waitFor(() => expect(copyMock).toHaveBeenCalledWith('hello'))
    expect(childClick).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
