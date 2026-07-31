import { computed, defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  ATTACHMENT_NODE_CONTEXT,
  INPUT_NODE_ACTIONS,
  type AttachmentOcrAvailability,
  type InputNodeActions
} from '@/components/chat/nodes/symbols'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: { icon: { type: String, required: true } },
    template: '<span :data-icon="icon" />'
  })
}))

vi.mock('@tiptap/vue-3', () => ({
  NodeViewWrapper: defineComponent({
    name: 'NodeViewWrapper',
    template: '<span><slot /></span>'
  })
}))

vi.mock('@shadcn/components/ui/dropdown-menu', () => {
  const passthrough = (name: string) =>
    defineComponent({
      name,
      template: '<div><slot /></div>'
    })
  return {
    DropdownMenu: defineComponent({
      name: 'DropdownMenu',
      emits: ['update:open'],
      template: '<div><slot /></div>'
    }),
    DropdownMenuContent: passthrough('DropdownMenuContent'),
    DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
    DropdownMenuItem: defineComponent({
      name: 'DropdownMenuItem',
      emits: ['select'],
      template: '<button data-testid="dropdown-menu-item"><slot /></button>'
    }),
    DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
    DropdownMenuRadioGroup: defineComponent({
      name: 'DropdownMenuRadioGroup',
      props: { modelValue: { type: String, required: true } },
      emits: ['update:modelValue'],
      template: '<div><slot /></div>'
    }),
    DropdownMenuRadioItem: defineComponent({
      name: 'DropdownMenuRadioItem',
      props: {
        value: { type: String, required: true },
        disabled: { type: Boolean, default: false }
      },
      template: '<div :data-value="value" :data-disabled="String(disabled)"><slot /></div>'
    })
  }
})

import FileAttachmentView from '@/components/chat/nodes/FileAttachmentView.vue'

function mountAttachment(
  attrs: Record<string, unknown>,
  actions: InputNodeActions = {
    prepareCommandFormSubmit: vi.fn(),
    removeSkill: vi.fn(),
    removeFile: vi.fn(),
    setFileRepresentation: vi.fn(),
    switchToVisionModel: vi.fn(),
    submitCommandForm: vi.fn(),
    cancelCommandForm: vi.fn()
  },
  context: {
    isAcpSession?: boolean
    supportsVision?: boolean | null
    ocrAvailability?: AttachmentOcrAvailability
    refreshOcrAvailability?: () => Promise<void>
  } = {}
) {
  const updateAttributes = vi.fn()
  const deleteNode = vi.fn()
  const isAcpSession = ref(context.isAcpSession ?? false)
  const supportsVision = ref<boolean | null>(context.supportsVision ?? null)
  const ocrAvailability = ref<AttachmentOcrAvailability>(
    context.ocrAvailability ?? { status: 'unknown' }
  )
  const refreshOcrAvailability =
    context.refreshOcrAvailability ?? vi.fn().mockResolvedValue(undefined)
  const wrapper = mount(FileAttachmentView, {
    props: {
      editor: {},
      node: { attrs },
      decorations: [],
      selected: false,
      extension: {},
      getPos: () => 0,
      updateAttributes,
      deleteNode,
      view: {},
      innerDecorations: {},
      HTMLAttributes: {}
    } as never,
    global: {
      provide: {
        [INPUT_NODE_ACTIONS as symbol]: actions,
        [ATTACHMENT_NODE_CONTEXT as symbol]: {
          isAcpSession: computed(() => isAcpSession.value),
          supportsVision: computed(() => supportsVision.value),
          ocrAvailability,
          refreshOcrAvailability
        }
      }
    }
  })
  return {
    actions,
    deleteNode,
    isAcpSession,
    ocrAvailability,
    refreshOcrAvailability,
    supportsVision,
    updateAttributes,
    wrapper
  }
}

describe('FileAttachmentView', () => {
  it('offers Auto, embedded text, and OCR for PDFs with a compact intent badge', async () => {
    const { actions, updateAttributes, wrapper } = mountAttachment({
      fileName: 'report.pdf',
      filePath: '/tmp/report.pdf',
      mimeType: 'application/pdf',
      requestedRepresentation: 'embedded_text'
    })

    expect(wrapper.get('[data-testid="attachment-representation-trigger"]').text()).toContain(
      'chat.attachments.embeddedTextBadge'
    )
    expect(
      wrapper.findAll('[data-value]').map((option) => option.attributes('data-value'))
    ).toEqual(['auto', 'embedded_text', 'ocr_text'])
    expect(wrapper.text()).not.toContain('chat.attachments.sendImage')

    wrapper
      .findComponent({ name: 'DropdownMenuRadioGroup' })
      .vm.$emit('update:modelValue', 'ocr_text')
    await wrapper.vm.$nextTick()

    expect(updateAttributes).toHaveBeenCalledWith({ requestedRepresentation: 'ocr_text' })
    expect(actions.setFileRepresentation).toHaveBeenCalledWith('/tmp/report.pdf', 'ocr_text')
  })

  it('keeps Auto implicit and normalizes a stale PDF-only value', () => {
    const { wrapper } = mountAttachment({
      fileName: 'scan.png',
      filePath: '/tmp/scan.png',
      mimeType: 'image/png',
      requestedRepresentation: 'embedded_text'
    })

    expect(wrapper.get('[data-testid="attachment-representation-trigger"]').text()).not.toContain(
      'chat.attachments.auto'
    )
    expect(
      wrapper.findAll('[data-value]').map((option) => option.attributes('data-value'))
    ).toEqual(['auto', 'image', 'ocr_text'])
  })

  it('does not add representation controls to unrelated files', () => {
    const { wrapper } = mountAttachment({
      fileName: 'notes.txt',
      filePath: '/tmp/notes.txt',
      mimeType: 'text/plain',
      requestedRepresentation: 'auto'
    })

    expect(wrapper.find('[data-testid="attachment-representation-trigger"]').exists()).toBe(false)
  })

  it('suppresses the no-op representation control for ACP without rewriting intent', () => {
    const actions: InputNodeActions = {
      prepareCommandFormSubmit: vi.fn(),
      removeSkill: vi.fn(),
      removeFile: vi.fn(),
      setFileRepresentation: vi.fn(),
      switchToVisionModel: vi.fn(),
      submitCommandForm: vi.fn(),
      cancelCommandForm: vi.fn()
    }
    const { updateAttributes, wrapper } = mountAttachment(
      {
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png',
        requestedRepresentation: 'ocr_text'
      },
      actions,
      { isAcpSession: true, supportsVision: true }
    )

    expect(wrapper.find('[data-testid="attachment-representation-trigger"]').exists()).toBe(false)
    expect(updateAttributes).not.toHaveBeenCalled()
    expect(actions.setFileRepresentation).not.toHaveBeenCalled()
  })

  it('blocks a new Image override for a known non-vision model and reuses model switching', async () => {
    const { actions, updateAttributes, wrapper } = mountAttachment(
      {
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png',
        requestedRepresentation: 'auto'
      },
      undefined,
      { supportsVision: false }
    )

    expect(wrapper.get('[data-value="image"]').attributes('data-disabled')).toBe('true')

    wrapper.findComponent({ name: 'DropdownMenuRadioGroup' }).vm.$emit('update:modelValue', 'image')
    await wrapper.vm.$nextTick()

    expect(updateAttributes).not.toHaveBeenCalled()
    expect(actions.setFileRepresentation).not.toHaveBeenCalled()

    wrapper.findComponent({ name: 'DropdownMenuItem' }).vm.$emit('select')
    expect(actions.switchToVisionModel).toHaveBeenCalledOnce()
  })

  it('fails open when model capability is unresolved', async () => {
    const { actions, updateAttributes, wrapper } = mountAttachment(
      {
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png',
        requestedRepresentation: 'auto'
      },
      undefined,
      { supportsVision: null }
    )

    expect(wrapper.get('[data-value="image"]').attributes('data-disabled')).toBe('false')

    wrapper.findComponent({ name: 'DropdownMenuRadioGroup' }).vm.$emit('update:modelValue', 'image')
    await wrapper.vm.$nextTick()

    expect(updateAttributes).toHaveBeenCalledWith({ requestedRepresentation: 'image' })
    expect(actions.setFileRepresentation).toHaveBeenCalledWith('/tmp/scan.png', 'image')
  })

  it('keeps an existing Image intent visible when the selected model becomes non-vision', () => {
    const { updateAttributes, wrapper } = mountAttachment(
      {
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png',
        requestedRepresentation: 'image'
      },
      undefined,
      { supportsVision: false }
    )

    expect(wrapper.get('[data-testid="attachment-representation-trigger"]').text()).toContain(
      'chat.attachments.imageBadge'
    )
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('loads OCR availability on demand and disables only a known unavailable runtime', async () => {
    const refreshOcrAvailability = vi.fn().mockResolvedValue(undefined)
    const { actions, ocrAvailability, updateAttributes, wrapper } = mountAttachment(
      {
        fileName: 'scan.png',
        filePath: '/tmp/scan.png',
        mimeType: 'image/png',
        requestedRepresentation: 'auto'
      },
      undefined,
      {
        ocrAvailability: { status: 'unknown' },
        refreshOcrAvailability
      }
    )

    wrapper.findComponent({ name: 'DropdownMenu' }).vm.$emit('update:open', true)
    expect(refreshOcrAvailability).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-value="ocr_text"]').attributes('data-disabled')).toBe('false')

    ocrAvailability.value = {
      status: 'unavailable',
      reason: 'unsupported_platform',
      lightOcrVersion: '0.5.5',
      bundleId: 'test-bundle'
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-value="ocr_text"]').attributes('data-disabled')).toBe('true')

    wrapper
      .findComponent({ name: 'DropdownMenuRadioGroup' })
      .vm.$emit('update:modelValue', 'ocr_text')
    await wrapper.vm.$nextTick()

    expect(updateAttributes).not.toHaveBeenCalled()
    expect(actions.setFileRepresentation).not.toHaveBeenCalled()
  })
})
