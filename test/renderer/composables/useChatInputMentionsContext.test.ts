import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Mention from '@tiptap/extension-mention'
import { FileReference } from '@/components/chat/nodes/fileReference'
import { useChatInputMentions } from '@/components/chat/composables/useChatInputMentions'

const { searchFiles } = vi.hoisted(() => ({ searchFiles: vi.fn() }))
vi.mock('@api/WorkspaceClient', () => ({
  createWorkspaceClient: () => ({ registerWorkspace: vi.fn(), searchFiles })
}))
vi.mock('@api/SessionClient', () => ({
  createSessionClient: () => ({
    searchReferenceCandidates: vi.fn().mockResolvedValue({ items: [] }),
    getAcpSessionCommands: vi.fn().mockResolvedValue([]),
    onAcpCommandsReady: vi.fn()
  })
}))
vi.mock('@/stores/mcp', () => ({
  useMcpStore: () => ({
    visiblePrompts: [],
    visibleTools: [],
    pluginTools: [],
    loadPrompts: vi.fn(),
    loadTools: vi.fn()
  })
}))
vi.mock('@/stores/skillsStore', () => ({
  useSkillsStore: () => ({ getSkillsForAgent: () => [], ensureSkillsLoaded: vi.fn() })
}))

const cleanups: Array<() => void> = []
function setup() {
  const sessionId = ref('session-a')
  const workspacePath = ref('/repo/a')
  let editor: Editor
  let mentions!: ReturnType<typeof useChatInputMentions>
  const onExit = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        mentions = useChatInputMentions({
          getEditor: () => editor,
          workspacePath,
          sessionId,
          agentId: ref('deepchat'),
          isAcpSession: ref(false),
          resolveSessionReference: vi.fn(),
          onCommandSubmit: vi.fn(),
          onActivateSkill: vi.fn()
        })
        return () => null
      }
    })
  )
  editor = new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      FileReference,
      Mention.configure({
        suggestion: { ...mentions.atSuggestion, render: () => ({ onExit }) }
      })
    ]
  })
  cleanups.push(() => {
    editor.destroy()
    wrapper.unmount()
  })
  return { editor, mentions, sessionId, workspacePath, onExit }
}

describe('reference suggestion context', () => {
  beforeEach(() => {
    searchFiles
      .mockReset()
      .mockImplementation(async (path: string) => [{ path: `${path}/notes.md`, name: 'notes.md' }])
  })
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  it('closes an active picker and rejects its saved selection after a session switch', async () => {
    const { editor, mentions, sessionId, onExit } = setup()
    editor.commands.insertContent('@notes')
    await flushPromises()
    const [item] = await mentions.atSuggestion.items({ query: 'notes' })
    sessionId.value = 'session-b'
    mentions.atSuggestion.command({ editor, range: { from: 1, to: 7 }, props: reactive(item) })
    expect(onExit).toHaveBeenCalled()
    expect(editor.getText()).toBe('@notes')
    expect(JSON.stringify(editor.getJSON())).not.toContain('fileReference')
  })

  it('discards a late search from an old workspace while accepting current proxied results', async () => {
    const { editor, mentions, workspacePath } = setup()
    let finish!: (files: unknown[]) => void
    searchFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const stale = mentions.atSuggestion.items({ query: 'notes' })
    await flushPromises()
    workspacePath.value = '/repo/b'
    const [current] = await mentions.atSuggestion.items({ query: 'notes' })
    finish([{ path: '/repo/a/notes.md', name: 'notes.md' }])
    expect(await stale).toEqual([])
    mentions.atSuggestion.command({ editor, range: { from: 1, to: 1 }, props: reactive(current) })
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({
      type: 'fileReference',
      attrs: { filePath: '/repo/b/notes.md', relativePath: 'notes.md' }
    })
  })

  it('does not insert a picked reference after the editor becomes read-only', async () => {
    const { editor, mentions } = setup()
    const [item] = await mentions.atSuggestion.items({ query: 'notes' })
    editor.setEditable(false)
    mentions.atSuggestion.command({ editor, range: { from: 1, to: 1 }, props: item })
    expect(editor.isEmpty).toBe(true)
  })
})
