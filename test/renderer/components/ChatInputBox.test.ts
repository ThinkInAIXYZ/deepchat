import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref, nextTick } from 'vue'
import { CHAT_INPUT_WORKSPACE_ITEM_MIME } from '@/lib/chatInputWorkspaceReference'

const handlePasteMock = vi.fn().mockResolvedValue(undefined)
const handleDropMock = vi.fn().mockResolvedValue(undefined)
const openFilePickerMock = vi.fn()
const deleteFileMock = vi.fn()
const updateFileMock = vi.fn()
const insertContentMock = vi.fn()
const selectedFilesRef = ref<any[]>([])
const activeSkillsRef = ref<string[]>([])
const pendingSkillsRef = ref<string[]>([])
const activateSkillMock = vi.fn().mockResolvedValue(undefined)
const deactivateSkillMock = vi.fn().mockResolvedValue(undefined)
const closeDialogMock = vi.fn()
const useChatInputMentionsMock = vi.fn((_options?: unknown) => ({
  atSuggestion: {},
  slashSuggestion: {},
  dialogState: ref(null),
  submitDialog: vi.fn(),
  closeDialog: closeDialogMock,
  isSuggestionMenuOpen: ref(false),
  shouldSuppressSubmit: vi.fn(() => false)
}))
const useSkillsDataMock = vi.fn((_conversationId?: unknown, _agentId?: unknown) => ({
  skills: ref([]),
  activeSkills: activeSkillsRef,
  activeCount: ref(0),
  activeSkillItems: ref([]),
  composerActiveSkills: activeSkillsRef,
  composerActiveCount: ref(0),
  composerActiveSkillItems: ref([]),
  availableSkills: ref([]),
  loading: ref(false),
  pendingSkills: pendingSkillsRef,
  loadActiveSkills: vi.fn(),
  toggleSkill: vi.fn(),
  activateSkill: activateSkillMock,
  deactivateSkill: deactivateSkillMock,
  consumePendingSkills: consumePendingSkillsMock,
  clearPendingSkills: clearPendingSkillsMock
}))
let lastEditorOptions: any = null
let lastEditorInstance: any = null
let mockEditorText = ''
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
    public commandMock = vi.fn()
    public state = {
      doc: {
        content: {
          size: 0
        },
        textBetween: vi.fn(() => ''),
        descendants: vi.fn(),
        forEach: vi.fn(),
        firstChild: null,
        nodeAt: vi.fn(() => null)
      },
      selection: {
        from: 0,
        to: 0
      },
      tr: (() => {
        const tr: any = {
          meta: {},
          setSelection: vi.fn(() => tr),
          delete: vi.fn(() => tr),
          setMeta: vi.fn((key: string, value: unknown) => {
            tr.meta[key] = value
            return tr
          }),
          getMeta: vi.fn((key: string) => tr.meta[key])
        }
        return tr
      })()
    }
    public view = {
      dispatch: vi.fn((tr: any) => {
        this.commandMock(tr)
        lastEditorOptions?.onUpdate?.({ editor: this, transaction: tr })
      }),
      updateState: vi.fn()
    }
    public setEditable = vi.fn()
    constructor(options: any) {
      lastEditorOptions = options
      lastEditorInstance = this
    }
    getText() {
      return mockEditorText
    }
    getJSON() {
      return { type: 'doc', content: [{ type: 'paragraph' }] }
    }
    chain() {
      const api = {
        focus: () => api,
        insertContent: (content: string) => {
          insertContentMock(content)
          return api
        },
        insertContentAt: vi.fn((...args: any[]) => {
          this.commandMock({ command: 'insertContentAt', args })
          return api
        }),
        deleteRange: vi.fn(() => api),
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

vi.mock('@tiptap/core', () => ({
  Node: {
    create: vi.fn((config: any) => config || {})
  },
  mergeAttributes: (...attrs: any[]) => Object.assign({}, ...attrs)
}))
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
    updateFile: updateFileMock,
    clearFiles: vi.fn(),
    handlePromptFiles: vi.fn(),
    openFilePicker: openFilePickerMock
  })
}))

vi.mock('@/components/chat/composables/useChatInputMentions', () => ({
  useChatInputMentions: (options: unknown) => useChatInputMentionsMock(options)
}))

vi.mock('@/components/chat-input/composables/useSkillsData', () => ({
  useSkillsData: (conversationId: unknown, agentId: unknown) =>
    useSkillsDataMock(conversationId, agentId)
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
    lastEditorInstance = null
    mockEditorText = ''
    closeDialogMock.mockClear()
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

  const mountComponent = async (options?: { files?: any[]; agentId?: string }) => {
    const ChatInputBox = (await import('@/components/chat/ChatInputBox.vue')).default
    return mount(ChatInputBox, {
      props: {
        modelValue: '',
        files: options?.files ?? [],
        agentId: options?.agentId
      },
      global: {
        stubs: {
          CommandInputDialog: true
        }
      }
    })
  }

  it('passes a reactive Agent scope to Skill picker data and mentions', async () => {
    const wrapper = await mountComponent({ agentId: 'agent-b' })
    const skillsAgentId = useSkillsDataMock.mock.calls.at(-1)?.[1] as { value: string } | undefined
    const mentionOptions = useChatInputMentionsMock.mock.calls.at(-1)?.[0] as
      | { agentId: { value: string } }
      | undefined

    expect(skillsAgentId?.value).toBe('agent-b')
    expect(mentionOptions?.agentId.value).toBe('agent-b')

    await wrapper.setProps({ agentId: 'agent-a' })

    expect(skillsAgentId?.value).toBe('agent-a')
    expect(mentionOptions?.agentId.value).toBe('agent-a')
  })

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

  it('locks editor mutations when editable is disabled', async () => {
    const wrapper = await mountComponent()
    expect(lastEditorOptions?.editable).toBe(true)

    await wrapper.setProps({ editable: false })

    expect(lastEditorInstance.setEditable).toHaveBeenCalledWith(false)
    expect(wrapper.get('[data-testid="chat-input-editor"]').attributes('aria-disabled')).toBe(
      'true'
    )
    ;(wrapper.vm as any).triggerAttach()
    expect(openFilePickerMock).not.toHaveBeenCalled()
    expect((wrapper.vm as any).insertWorkspaceReference('/repo/locked.txt')).toBe(false)
  })

  it('preserves copy, selection, and focus navigation while editing is disabled', async () => {
    const wrapper = await mountComponent()
    await wrapper.setProps({ editable: false })
    const editor = wrapper.get('[data-testid="chat-input-editor"]').element
    const dispatchKey = (key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init
      })
      editor.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(dispatchKey('Tab')).toBe(false)
    expect(dispatchKey('ArrowLeft', { shiftKey: true })).toBe(false)
    expect(dispatchKey('c', { ctrlKey: true })).toBe(false)
    expect(dispatchKey('a', { metaKey: true })).toBe(false)
    expect(dispatchKey('x')).toBe(true)
    expect(dispatchKey('v', { metaKey: true })).toBe(true)
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

  it('tracks attached file state via the files composable', async () => {
    await mountComponent({
      files: [{ name: 'a.txt', path: '/tmp/a.txt' }]
    })
    selectedFilesRef.value = [{ name: 'a.txt', path: '/tmp/a.txt' }]
    await nextTick()

    expect(selectedFilesRef.value.length).toBe(1)

    deleteFileMock(0)
    expect(deleteFileMock).toHaveBeenCalledWith(0)
  })

  const textNode = (text: string) => ({ type: { name: 'text' }, text, attrs: {} })
  const node = (name: string, attrs: Record<string, string>, nodeSize = 1) => ({
    type: { name },
    attrs,
    nodeSize
  })
  const block = (children: any[]) => ({
    forEach: (callback: (node: any) => void) => children.forEach(callback)
  })

  it('exposes inline item snapshots at plain text offsets', async () => {
    const wrapper = await mountComponent()

    expect(lastEditorOptions).toBeTruthy()
    const editor = lastEditorInstance
    expect(editor).toBeTruthy()
    editor.state.doc.forEach = (callback: (block: any, offset: number, index: number) => void) => {
      callback(
        block([
          textNode('我想要使用'),
          node('skillChip', { skillName: 'skillA' }),
          textNode(' ，把 '),
          node('fileAttachment', {
            fileName: 'file.pdf',
            filePath: '/tmp/file.pdf',
            mimeType: 'application/pdf'
          })
        ]),
        0,
        0
      )
      callback(block([textNode('文件怎么样怎么样')]), 0, 1)
    }

    expect((wrapper.vm as any).getInlineItemsSnapshot()).toEqual([
      { type: 'skill', offset: 5, skillName: 'skillA' },
      {
        type: 'file',
        offset: 9,
        fileName: 'file.pdf',
        filePath: '/tmp/file.pdf',
        mimeType: 'application/pdf'
      }
    ])
  })

  it('syncs deleted inline editor nodes back to backing state on editor update', async () => {
    const wrapper = await mountComponent()
    activeSkillsRef.value = ['skillA']
    selectedFilesRef.value = [
      { name: 'file.pdf', path: '/tmp/file.pdf', mimeType: 'application/pdf' }
    ]
    const editor = lastEditorInstance
    expect(editor).toBeTruthy()
    editor.state.doc.descendants = (callback: (node: any, pos: number) => void) => {
      callback(node('paragraph', {}, 1), 0)
    }

    lastEditorOptions.onUpdate({
      editor,
      transaction: { getMeta: vi.fn(() => false) }
    })

    expect(deactivateSkillMock).toHaveBeenCalledWith('skillA')
    expect(deleteFileMock).toHaveBeenCalledWith(0)
    expect(wrapper.emitted('draft-change')).toHaveLength(1)
  })

  it('clears pending command form data when the inline form node is removed by editor update', async () => {
    await mountComponent()
    const editor = lastEditorInstance
    expect(editor).toBeTruthy()
    editor.state.doc.descendants = (callback: (node: any, pos: number) => void) => {
      callback(node('paragraph', {}, 1), 0)
    }

    lastEditorOptions.onUpdate({
      editor,
      transaction: { getMeta: vi.fn(() => false) }
    })

    expect(closeDialogMock).toHaveBeenCalled()
  })

  it('does not reconcile inline nodes for internal sync transactions', async () => {
    const wrapper = await mountComponent()
    activeSkillsRef.value = ['skillA']
    selectedFilesRef.value = [
      { name: 'file.pdf', path: '/tmp/file.pdf', mimeType: 'application/pdf' }
    ]
    const editor = lastEditorInstance
    expect(editor).toBeTruthy()
    editor.state.doc.descendants = (callback: (node: any, pos: number) => void) => {
      callback(node('paragraph', {}, 1), 0)
    }

    lastEditorOptions.onUpdate({
      editor,
      transaction: { getMeta: vi.fn(() => true) }
    })

    expect(deactivateSkillMock).not.toHaveBeenCalled()
    expect(deleteFileMock).not.toHaveBeenCalled()
    expect(closeDialogMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('draft-change')).toBeUndefined()
  })

  it('does not emit stale text while syncing file chips after files are cleared', async () => {
    const wrapper = await mountComponent({
      files: [{ name: 'file.pdf', path: '/tmp/file.pdf', mimeType: 'application/pdf' }]
    })
    const editor = lastEditorInstance
    expect(editor).toBeTruthy()
    mockEditorText = '帮我查看'
    editor.state.doc.descendants = (callback: (node: any, pos: number) => void) => {
      callback(
        node(
          'fileAttachment',
          { fileName: 'file.pdf', filePath: '/tmp/file.pdf', mimeType: 'application/pdf' },
          1
        ),
        1
      )
    }

    await wrapper.setProps({ modelValue: '', files: [] })
    await nextTick()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
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

  it('restores normalized pending skills for a blocked initial draft', async () => {
    const wrapper = await mountComponent()

    ;(wrapper.vm as any).setPendingSkills([' review ', '', 'review', 'commit'])

    expect(pendingSkillsRef.value).toEqual(['review', 'commit'])
    expect((wrapper.vm as any).getPendingSkillsSnapshot()).toEqual(['review', 'commit'])
  })

  it('exposes editor document snapshots and reports session skill draft changes', async () => {
    const wrapper = await mountComponent()
    await wrapper.setProps({ sessionId: 's1' })
    pendingSkillsRef.value = ['review']
    await nextTick()

    expect(wrapper.emitted('pending-skills-change')?.at(-1)).toEqual([['review']])
    expect((wrapper.vm as any).getDocumentSnapshot()).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }]
    })

    const restored = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored' }] }]
    }
    ;(wrapper.vm as any).restoreDocumentSnapshot(restored)

    expect(lastEditorInstance.commands.setContent).toHaveBeenCalledWith(restored, false)
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
