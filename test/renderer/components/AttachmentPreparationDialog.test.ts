import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === 'chat.attachments.attachmentNumber'
        ? `Attachment ${String(params?.number ?? '')}`
        : key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<span />' })
}))

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'Button',
    props: { disabled: { type: Boolean, default: false } },
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/spinner', () => ({
  Spinner: defineComponent({ name: 'Spinner', template: '<span data-testid="spinner" />' })
}))

vi.mock('@shadcn/components/ui/dialog', () => {
  const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })
  return {
    Dialog: defineComponent({
      name: 'Dialog',
      props: { open: { type: Boolean, required: true } },
      template: '<div v-if="open"><slot /></div>'
    }),
    DialogContent: passthrough('DialogContent'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle')
  }
})

import AttachmentPreparationDialog from '@/components/chat/AttachmentPreparationDialog.vue'

describe('AttachmentPreparationDialog', () => {
  it('renders body-free reasons and emits only the offered actions', async () => {
    const wrapper = mount(AttachmentPreparationDialog, {
      props: {
        open: true,
        summary: {
          status: 'needs_user_action',
          issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
          suggestedActions: ['retry', 'send_without_image_content', 'switch_to_vision_model']
        }
      }
    })

    expect(wrapper.text()).toContain('Attachment 1')
    expect(wrapper.text()).toContain('chat.attachments.reasons.ocr_empty')
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(4)

    await buttons[0].trigger('click')
    await buttons[1].trigger('click')
    await buttons[2].trigger('click')
    await buttons[3].trigger('click')

    expect(wrapper.emitted('cancel')).toEqual([[]])
    expect(wrapper.emitted('switch-model')).toEqual([[]])
    expect(wrapper.emitted('retry')).toEqual([[]])
    expect(wrapper.emitted('send-without-image-content')).toEqual([[]])
  })

  it('disables decisions while a retry is running', () => {
    const wrapper = mount(AttachmentPreparationDialog, {
      props: {
        open: true,
        processing: true,
        summary: {
          status: 'needs_user_action',
          issues: [],
          suggestedActions: ['retry', 'send_without_image_content']
        }
      }
    })

    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)
    ).toBe(true)
    expect(wrapper.find('[data-testid="spinner"]').exists()).toBe(true)
  })

  it('keeps draft cancellation available when explicitly allowed during processing', async () => {
    const wrapper = mount(AttachmentPreparationDialog, {
      props: {
        open: true,
        processing: true,
        cancelWhileProcessing: true,
        summary: {
          status: 'needs_user_action',
          issues: [],
          suggestedActions: ['retry']
        }
      }
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('disabled')).toBeUndefined()
    expect(buttons[1].attributes('disabled')).toBeDefined()

    await buttons[0].trigger('click')
    expect(wrapper.emitted('cancel')).toEqual([[]])
  })
})
