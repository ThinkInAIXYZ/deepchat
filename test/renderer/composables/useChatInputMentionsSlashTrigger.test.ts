import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { SlashMention } from '@/components/editor/mention/slashMention'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const mockMentionDependencies = () => {
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: () => ({
      getAcpSessionCommands: vi.fn().mockResolvedValue([]),
      onAcpCommandsReady: vi.fn(() => () => undefined)
    })
  }))
  vi.doMock('@api/WorkspaceClient', () => ({
    createWorkspaceClient: () => ({
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
      searchFiles: vi.fn().mockResolvedValue([])
    })
  }))
  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => ({
      visiblePrompts: [],
      visibleTools: [],
      pluginTools: [],
      loadPrompts: vi.fn().mockResolvedValue(undefined),
      loadTools: vi.fn().mockResolvedValue(undefined),
      getPrompt: vi.fn()
    })
  }))
  vi.doMock('@/stores/skillsStore', () => ({
    useSkillsStore: () => ({
      getSkillsForAgent: () => [],
      ensureSkillsLoaded: vi.fn().mockResolvedValue(undefined)
    })
  }))
}

const loadSlashSuggestion = async () => {
  mockMentionDependencies()
  const { useChatInputMentions } =
    await import('@/components/chat/composables/useChatInputMentions')
  let slashSuggestion: Record<string, unknown> | null = null
  const Harness = defineComponent({
    setup() {
      const mentions = useChatInputMentions({
        getEditor: () => null,
        workspacePath: ref(null),
        sessionId: ref(null),
        agentId: ref('deepchat'),
        isAcpSession: ref(false),
        onCommandSubmit: vi.fn(),
        onActivateSkill: vi.fn()
      })
      slashSuggestion = mentions.slashSuggestion as unknown as Record<string, unknown>
      return () => null
    }
  })

  const wrapper = mount(Harness)
  const suggestion = slashSuggestion as unknown as Record<string, unknown> | null
  if (!suggestion) throw new Error('slash suggestion config was not created')
  return { wrapper, suggestion }
}

/** Builds a real editor on top of the production slash config and records menu activation. */
const createSlashEditor = (suggestion: Record<string, unknown>) => {
  const onStart = vi.fn()
  const editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      SlashMention.configure({
        suggestion: {
          ...suggestion,
          render: () => ({ onStart })
        }
      })
    ]
  })

  return { editor, onStart }
}

const setDraft = (editor: Editor, text: string) => {
  editor.commands.setContent(`<p>${text}</p>`)
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
}

describe('slash suggestion trigger', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it.each([
    'https://github.com/lodyai/lody',
    'src/main/index.ts',
    '~/Documents/notes.md',
    'mail me at /tmp/report.pdf'
  ])('keeps the slash menu closed for %s', async (text) => {
    const { wrapper, suggestion } = await loadSlashSuggestion()
    const { editor, onStart } = createSlashEditor(suggestion)

    setDraft(editor, text)
    await Promise.resolve()

    expect(onStart).not.toHaveBeenCalled()
    editor.destroy()
    wrapper.unmount()
  })

  it.each([
    ['/compact', 'compact'],
    ['/com', 'com'],
    ['summarize this /compact', 'compact']
  ])('opens the menu for %s at a command position', async (text, query) => {
    const { wrapper, suggestion } = await loadSlashSuggestion()
    const { editor, onStart } = createSlashEditor(suggestion)

    setDraft(editor, text)
    await Promise.resolve()

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart.mock.calls.at(-1)?.[0]?.query).toBe(query)
    editor.destroy()
    wrapper.unmount()
  })
})
