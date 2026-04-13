import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick } from 'vue'
import { CHAT_INPUT_WORKSPACE_ITEM_MIME } from '@/lib/chatInputWorkspaceReference'

const handlePasteMock = vi.fn().mockResolvedValue(undefined)
const handleDropMock = vi.fn().mockResolvedValue(undefined)
const openFilePickerMock = vi.fn()
const deleteFileMock = vi.fn()
const insertContentMock = vi.fn()
const selectedFilesRef = ref<any[]>([])
const activeSkillsRef = ref<string[]>([])
const pendingSkillsRef = ref<string[]>([])
const activateSkillMock = vi.fn().mockResolvedValue(undefined)
const deactivateSkillMock = vi.fn().mockResolvedValue(undefined)
let lastEditorOptions: any = null
const consumePendingSkillsMock = vi.fn(() => {
  const copied = [...pendingSkillsRef.value]
  pendingSkillsRef.value = []
  return copied
})
const applyPendingSkillsToConversationMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@tiptap/vue-3', () => {
  class MockEditor {
    public commands = {
      setContent: vi.fn()
    }
    public state = {
      doc: {
        content: {
          size: 0
        },
        textBetween: vi.fn(() => '')
      },
      selection: {
        from: 0,
        to: 0
      },
      tr: {
        setSelection: vi.fn()
      }
    }
    public view = {
      dispatch: vi.fn(),
      updateState: vi.fn()
    }
    constructor(options: any) {
      lastEditorOptions = options
    }
    getText() {
      return ''
    }
    chain() {
      const api = {
        focus: () => api,
        insertContent: (content: string) => {
          insertContentMock(content)
          return api
        },
        run: () => true,
        setHardBreak: () => ({
          scrollIntoView: () => ({
            run: () => true
          })
        })
      }
      return {
        ...api
      }
    }
    destroy() {}
  }

  return {
    Editor: MockEditor,
    EditorContent: defineComponent({
      name: 'EditorContent',
      template: '<div data-testid="editor-content"></div>'
    })
  }
})

vi.mock('@tiptap/core', () => ({}))
vi.mock('@tiptap/extension-mention', () => ({
  default: {
    configure: () => ({}),
    extend: () => ({
      configure: () => ({})
    })
  }
}))
vi.mock('@tiptap/extension-document', () => ({ default: {} }))
vi.mock('@tiptap/extension-paragraph', () => ({ default: {} }))
vi.mock('@tiptap/extension-text', () => ({ default: {} }))
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }))
vi.mock('@tiptap/extension-hard-break', () => ({ default: { extend: () => ({}) } }))
vi.mock('@tiptap/extension-history', () => ({ default: {} }))
vi.mock('@tiptap/pm/state', () => ({ TextSelection: { atEnd: () => ({}) } }))

vi.mock('@/components/chat/composables/useChatInputFiles', () => ({
  useChatInputFiles: () => ({
    selectedFiles: selectedFilesRef,
    handleFileSelect: vi.fn(),
    handlePaste: handlePasteMock,
    handleDrop: handleDropMock,
    deleteFile: deleteFileMock,
    clearFiles: vi.fn(),
    handlePromptFiles: vi.fn(),
    openFilePicker: openFilePickerMock
  })
}))

vi.mock('@/components/chat/composables/useChatInputMentions', () => ({
  useChatInputMentions: () => ({
    atSuggestion: {},
    slashSuggestion: {},
    dialogState: ref(null),
    submitDialog: vi.fn(),
    closeDialog: vi.fn(),
    isSuggestionMenuOpen: ref(false),
    shouldSuppressSubmit: vi.fn(() => false)
  })
}))

vi.mock('@/components/chat-input/composables/useSkillsData', () => ({
  useSkillsData: () => ({
    skills: ref([]),
    activeSkills: activeSkillsRef,
    activeCount: ref(0),
    activeSkillItems: ref([]),
    availableSkills: ref([]),
    loading: ref(false),
    pendingSkills: pendingSkillsRef,
    loadActiveSkills: vi.fn(),
    toggleSkill: vi.fn(),
    activateSkill: activateSkillMock,
    deactivateSkill: deactivateSkillMock,
    consumePendingSkills: consumePendingSkillsMock,
    applyPendingSkillsToConversation: applyPendingSkillsToConversationMock
  })
}))

vi.mock('@/stores/mcp', () => ({
  useMcpStore: () => ({
    mcpEnabled: false
  })
}))

vi.mock('@/components/chat-input/McpIndicator.vue', () => ({
  default: defineComponent({
    name: 'McpIndicator',
    template: '<div data-testid="mcp-indicator"></div>'
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('ChatInputBox attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectedFilesRef.value = []
    activeSkillsRef.value = []
    pendingSkillsRef.value = []
    lastEditorOptions = null
  })

  const mountComponent = async (options?: { files?: any[] }) => {
    const ChatInputBox = (await import('@/components/chat/ChatInputBox.vue')).default
    return mount(ChatInputBox, {
      props: {
        modelValue: '',
        files: options?.files ?? []
      },
      global: {
        stubs: {
          CommandInputDialog: true
        }
      }
    })
  }

  it('exposes triggerAttach and calls file picker', async () => {
    const wrapper = await mountComponent()
    ;(wrapper.vm as any).triggerAttach()
    expect(openFilePickerMock).toHaveBeenCalledTimes(1)
  })

  it('handles paste files via composable', async () => {
    const wrapper = await mountComponent()
    await wrapper.find('.chat-input-editor').trigger('paste')
    expect(handlePasteMock).toHaveBeenCalled()
  })

  it('configures the editor with a bounded scrollable input area', async () => {
    await mountComponent()
    expect(lastEditorOptions?.editorProps?.attributes?.class).toContain('min-h-[60px]')
    expect(lastEditorOptions?.editorProps?.attributes?.class).toContain('max-h-[240px]')
    expect(lastEditorOptions?.editorProps?.attributes?.class).toContain('overflow-y-auto')
    expect(lastEditorOptions?.editorProps?.attributes?.class).toContain('overscroll-contain')
  })

  it('handles drop files via composable', async () => {
    const wrapper = await mountComponent()
    const files = {
      length: 1,
      item: () => null
    } as unknown as FileList
    await wrapper.trigger('drop', {
      dataTransfer: { files }
    })
    expect(handleDropMock).toHaveBeenCalledWith(files)
  })

  it('inserts workspace references for internal workspace drops', async () => {
    const wrapper = await mountComponent()
    const dataTransfer = {
      types: [CHAT_INPUT_WORKSPACE_ITEM_MIME],
      getData: vi.fn(() =>
        JSON.stringify({
          path: '/repo/src/App.vue',
          isDirectory: false
        })
      )
    } as unknown as DataTransfer

    await wrapper.setProps({
      workspacePath: '/repo'
    })
    await wrapper.trigger('drop', { dataTransfer })

    expect(insertContentMock).toHaveBeenCalledWith('@src/App.vue ')
    expect(handleDropMock).not.toHaveBeenCalled()
  })

  it('handles remove attached file', async () => {
    const wrapper = await mountComponent({
      files: [{ name: 'a.txt', path: '/tmp/a.txt' }]
    })
    selectedFilesRef.value = [{ name: 'a.txt', path: '/tmp/a.txt' }]
    await nextTick()
    await wrapper.find('.group button[type="button"]').trigger('click')
    expect(deleteFileMock).toHaveBeenCalledWith(0)
  })

  it('exposes deduplicated pending skills snapshot', async () => {
    pendingSkillsRef.value = ['review', 'review', 'commit']
    const wrapper = await mountComponent()
    expect((wrapper.vm as any).getPendingSkillsSnapshot()).toEqual(['review', 'commit'])
  })
})
