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
const clearPendingSkillsMock = vi.fn(() => {
  pendingSkillsRef.value = []
})

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
    clearPendingSkills: clearPendingSkillsMock
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
    Object.assign(((window as any).api ??= {}), {
      toRelativePath: vi.fn((filePath: string, basePath?: string) => {
        if (typeof filePath !== 'string' || typeof basePath !== 'string') {
          return filePath
        }

        const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').trim()
        const normalizedFilePath = normalize(filePath)
        const normalizedBasePath = normalize(basePath)

        if (!normalizedBasePath) {
          return filePath
        }

        if (normalizedFilePath === normalizedBasePath) {
          return ''
        }

        const basePrefix = `${normalizedBasePath}/`
        if (normalizedFilePath.startsWith(basePrefix)) {
          return normalizedFilePath.slice(basePrefix.length)
        }

        return filePath
      })
    })
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

  const dispatchPaste = async (wrapper: Awaited<ReturnType<typeof mountComponent>>, data: any) => {
    const event = new Event('paste', {
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(event, 'clipboardData', {
      value: data
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    const stopPropagation = vi.spyOn(event, 'stopPropagation')

    wrapper.find('.chat-input-editor').element.dispatchEvent(event)
    await nextTick()

    return {
      preventDefault,
      stopPropagation
    }
  }

  it('exposes triggerAttach and calls file picker', async () => {
    const wrapper = await mountComponent()
    ;(wrapper.vm as any).triggerAttach()
    expect(openFilePickerMock).toHaveBeenCalledTimes(1)
  })

  it('exposes insertRecognizedText and inserts text into the editor', async () => {
    const wrapper = await mountComponent()
    ;(wrapper.vm as any).insertRecognizedText('hello world')
    expect(insertContentMock).toHaveBeenCalledWith('hello world')
  })

  it('exposes insertWorkspaceReference and inserts a workspace reference into the editor', async () => {
    const wrapper = await mountComponent()
    await wrapper.setProps({ workspacePath: '/repo' })

    expect((wrapper.vm as any).insertWorkspaceReference('/repo/src/App.vue')).toBe(true)
    expect(insertContentMock).toHaveBeenCalledWith('@src/App.vue ')
  })

  it('handles paste files via composable', async () => {
    const wrapper = await mountComponent()
    await wrapper.find('.chat-input-editor').trigger('paste')
    expect(handlePasteMock).toHaveBeenCalled()
  })

  it('inserts only the URL for browser rich URL paste payloads', async () => {
    const wrapper = await mountComponent()
    const clipboardData = {
      files: { length: 0 },
      getData: vi.fn((format: string) => {
        if (format === 'text/plain') {
          return 'https://example.com/a?b=1#c'
        }
        if (format === 'text/html') {
          return '<a href="https://example.com/a?b=1#c">Example title</a><p>Description</p>'
        }
        return ''
      })
    }

    const { preventDefault, stopPropagation } = await dispatchPaste(wrapper, clipboardData)

    expect(handlePasteMock).toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalledTimes(1)
    expect(insertContentMock).toHaveBeenCalledWith('https://example.com/a?b=1#c')
  })

  it('leaves ordinary text paste to the editor default handler', async () => {
    const wrapper = await mountComponent()
    const clipboardData = {
      files: { length: 0 },
      getData: vi.fn((format: string) => {
        if (format === 'text/plain') {
          return 'visit https://example.com'
        }
        if (format === 'text/html') {
          return '<p>visit <a href="https://example.com">Example</a></p>'
        }
        return ''
      })
    }

    const { preventDefault, stopPropagation } = await dispatchPaste(wrapper, clipboardData)

    expect(handlePasteMock).toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(insertContentMock).not.toHaveBeenCalled()
  })

  it('does not intercept file paste payloads as URLs', async () => {
    const wrapper = await mountComponent()
    const clipboardData = {
      files: { length: 1 },
      getData: vi.fn((format: string) => {
        if (format === 'text/plain') {
          return 'https://example.com'
        }
        return ''
      })
    }

    const { preventDefault, stopPropagation } = await dispatchPaste(wrapper, clipboardData)

    expect(handlePasteMock).toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(insertContentMock).not.toHaveBeenCalled()
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

  it('exposes and clears deduplicated pending skills snapshot', async () => {
    pendingSkillsRef.value = ['review', 'review', 'commit']
    const wrapper = await mountComponent()
    expect((wrapper.vm as any).getPendingSkillsSnapshot()).toEqual(['review', 'commit'])
    expect((wrapper.vm as any).consumePendingSkills()).toEqual(['review', 'commit'])
    expect(pendingSkillsRef.value).toEqual([])

    pendingSkillsRef.value = ['commit']
    ;(wrapper.vm as any).clearPendingSkills()
    expect(pendingSkillsRef.value).toEqual([])
  })

  it('emits queue-submit on Tab only when queue submit is available', async () => {
    const wrapper = await mountComponent()

    await wrapper.setProps({
      queueSubmitEnabled: true,
      queueSubmitDisabled: false
    })
    await wrapper.get('[data-testid="chat-input-editor"]').trigger('keydown', {
      key: 'Tab'
    })

    expect(wrapper.emitted('queue-submit')).toEqual([[]])

    await wrapper.setProps({
      queueSubmitDisabled: false
    })
    await wrapper.get('[data-testid="chat-input-editor"]').trigger('keydown', {
      key: 'Tab',
      shiftKey: true
    })

    expect(wrapper.emitted('queue-submit')).toEqual([[]])

    await wrapper.setProps({
      queueSubmitDisabled: true
    })
    await wrapper.get('[data-testid="chat-input-editor"]').trigger('keydown', {
      key: 'Tab'
    })

    expect(wrapper.emitted('queue-submit')).toEqual([[]])
  })
})
