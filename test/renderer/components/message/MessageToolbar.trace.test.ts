import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

let traceDebugEnabled = true

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => ({
    get traceDebugEnabled() {
      return traceDebugEnabled
    }
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon'],
    template: '<span :data-icon="icon"></span>'
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock(
  '@shadcn/components/ui/button',
  () => ({
    Button: {
      name: 'Button',
      template: '<button @click="$emit(\'click\')"><slot /></button>'
    }
  }),
  { virtual: true }
)

vi.mock(
  '@shadcn/components/ui/tooltip',
  () => ({
    TooltipProvider: {
      name: 'TooltipProvider',
      template: '<div><slot /></div>'
    },
    Tooltip: {
      name: 'Tooltip',
      template: '<div><slot /></div>'
    },
    TooltipTrigger: {
      name: 'TooltipTrigger',
      template: '<div><slot /></div>'
    },
    TooltipContent: {
      name: 'TooltipContent',
      template: '<div><slot /></div>'
    }
  }),
  { virtual: true }
)

import MessageToolbar from '@/components/message/MessageToolbar.vue'

const baseProps = {
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    reasoning_start_time: 0,
    reasoning_end_time: 0,
    input_tokens: 0,
    output_tokens: 0
  },
  loading: false,
  isAssistant: true,
  isCapturingImage: false,
  showTrace: true,
  isInGeneratingThread: false,
  isReadOnly: false
}

const mountToolbar = () =>
  mount(MessageToolbar, {
    props: baseProps
  })

describe('MessageToolbar trace button visibility', () => {
  it('shows trace button only when trace debug is enabled and message allows trace', async () => {
    traceDebugEnabled = true
    const wrapper = mountToolbar()

    const traceIcon = wrapper.find('[data-icon="lucide:bug"]')
    expect(traceIcon.exists()).toBe(true)

    await traceIcon.trigger('click')
    expect(wrapper.emitted().trace).toBeTruthy()
  })

  it('hides trace button when trace debug is disabled', () => {
    traceDebugEnabled = false
    const wrapper = mountToolbar()

    expect(wrapper.find('[data-icon="lucide:bug"]').exists()).toBe(false)
  })

  it('hides trace button when message does not have trace', () => {
    traceDebugEnabled = true
    const wrapper = mount(MessageToolbar, {
      props: {
        ...baseProps,
        showTrace: false
      }
    })

    expect(wrapper.find('[data-icon="lucide:bug"]').exists()).toBe(false)
  })

  it('hides mutating actions in read-only mode but keeps copy', () => {
    traceDebugEnabled = true
    const wrapper = mount(MessageToolbar, {
      props: {
        ...baseProps,
        isReadOnly: true
      }
    })

    expect(wrapper.find('[data-icon="lucide:refresh-cw"]').exists()).toBe(false)
    expect(wrapper.find('[data-icon="lucide:git-branch"]').exists()).toBe(false)
    expect(wrapper.find('[data-icon="lucide:trash-2"]').exists()).toBe(false)
    expect(wrapper.find('[data-icon="lucide:copy"]').exists()).toBe(true)
  })
})
