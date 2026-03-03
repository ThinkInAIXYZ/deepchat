import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { VueRenderer } from '@tiptap/vue-3'
import type { Editor, Range } from '@tiptap/core'
import tippy from 'tippy.js'
import type { PromptListEntry, WorkspaceFileNode } from '@shared/presenter'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { useMcpStore } from '@/stores/mcp'
import { useSkillsStore } from '@/stores/skillsStore'
import SuggestionList from '../mentions/SuggestionList.vue'
import {
  buildCommandText,
  flattenPromptResultToText,
  resolveSlashSelectionAction,
  sortSlashSuggestionItems,
  type AcpSessionCommand,
  type SlashSuggestionItem
} from '../mentions/utils'

export interface MentionDialogState {
  mode: 'command' | 'prompt'
  title: string
  description?: string
  fields: Array<{
    name: string
    label: string
    description?: string
    placeholder?: string
    required?: boolean
  }>
  confirmText?: string
}

export interface UseChatInputMentionsOptions {
  getEditor: () => Editor | null
  workspacePath: Ref<string | null>
  sessionId: Ref<string | null>
  isAcpSession: Ref<boolean>
  onCommandSubmit: (command: string) => void
  onPendingSkillsChange?: (skills: string[]) => void
}

interface FileSuggestionItem {
  id: string
  category: 'file'
  label: string
  description?: string
  payload: { path: string; insertText: string }
}

type SuggestionItem = FileSuggestionItem | SlashSuggestionItem

const normalizeAcpCommands = (commands: unknown): AcpSessionCommand[] => {
  if (!Array.isArray(commands)) {
    return []
  }

  return commands
    .map((command) => {
      if (!command || typeof command !== 'object') return null
      const record = command as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (!name) return null
      const description = typeof record.description === 'string' ? record.description.trim() : ''
      const inputRecord =
        record.input && typeof record.input === 'object'
          ? (record.input as Record<string, unknown>)
          : null
      const hint = typeof inputRecord?.hint === 'string' ? inputRecord.hint.trim() : ''

      return {
        name,
        description,
        input: hint ? { hint } : null
      }
    })
    .filter((command): command is NonNullable<typeof command> => command !== null)
}

export function useChatInputMentions(options: UseChatInputMentionsOptions) {
  const workspacePresenter = usePresenter('workspacePresenter')
  const newAgentPresenter = usePresenter('newAgentPresenter')
  const skillPresenter = usePresenter('skillPresenter')
  const mcpStore = useMcpStore()
  const skillsStore = useSkillsStore()

  const acpCommands = ref<AcpSessionCommand[]>([])
  const acpCommandFetchSeq = ref(0)
  const pendingSkills = ref<string[]>([])
  const isSuggestionMenuOpen = ref(false)
  const suppressSubmitUntil = ref(0)
  const registeredWorkspacePath = ref<string | null>(null)

  const dialogState = ref<MentionDialogState | null>(null)
  const pendingCommand = ref<AcpSessionCommand | null>(null)
  const pendingPrompt = ref<PromptListEntry | null>(null)

  const shouldSuppressSubmit = () => Date.now() < suppressSubmitUntil.value
  const markSuggestionSelected = () => {
    suppressSubmitUntil.value = Date.now() + 180
  }

  const closeDialog = () => {
    dialogState.value = null
    pendingCommand.value = null
    pendingPrompt.value = null
  }

  const notifyPendingSkills = () => {
    options.onPendingSkillsChange?.([...pendingSkills.value])
  }

  const ensureWorkspaceRegistered = async (): Promise<boolean> => {
    const workspacePath = options.workspacePath.value?.trim()
    if (!workspacePath) {
      return false
    }

    if (registeredWorkspacePath.value === workspacePath) {
      return true
    }

    try {
      if (options.isAcpSession.value) {
        await workspacePresenter.registerWorkdir(workspacePath)
      } else {
        await workspacePresenter.registerWorkspace(workspacePath)
      }
      registeredWorkspacePath.value = workspacePath
      return true
    } catch (error) {
      console.warn('[ChatInputMentions] Failed to register workspace:', error)
      return false
    }
  }

  const searchWorkspaceFiles = async (query: string): Promise<FileSuggestionItem[]> => {
    const workspacePath = options.workspacePath.value?.trim()
    if (!workspacePath) {
      return []
    }

    const registered = await ensureWorkspaceRegistered()
    if (!registered) {
      return []
    }

    try {
      const searchQuery = query.trim() || '**/*'
      const result =
        (await workspacePresenter.searchFiles(workspacePath, searchQuery)) ??
        ([] as WorkspaceFileNode[])

      return result.slice(0, 20).map((file) => {
        const relativePath = window.api.toRelativePath?.(file.path, workspacePath) ?? ''
        const displayPath = relativePath || file.name
        return {
          id: `file:${file.path}`,
          category: 'file' as const,
          label: displayPath,
          description: file.path,
          payload: {
            path: file.path,
            insertText: `@${displayPath} `
          }
        }
      })
    } catch (error) {
      console.warn('[ChatInputMentions] searchFiles failed:', error)
      return []
    }
  }

  const slashItems = computed<SlashSuggestionItem[]>(() => {
    const items: SlashSuggestionItem[] = []

    for (const command of acpCommands.value) {
      items.push({
        id: `command:${command.name}`,
        category: 'command',
        label: `/${command.name}`,
        description: command.description || command.input?.hint || '',
        payload: command
      })
    }

    for (const skill of skillsStore.skills) {
      items.push({
        id: `skill:${skill.name}`,
        category: 'skill',
        label: skill.name,
        description: skill.description,
        payload: { name: skill.name }
      })
    }

    for (const prompt of mcpStore.prompts) {
      items.push({
        id: `prompt:${prompt.client?.name || 'unknown'}:${prompt.name}`,
        category: 'prompt',
        label: prompt.name,
        description: prompt.description || '',
        payload: prompt
      })
    }

    for (const tool of mcpStore.tools) {
      items.push({
        id: `tool:${tool.server.name}:${tool.function.name ?? ''}`,
        category: 'tool',
        label: tool.function.name ?? '',
        description: tool.function.description || '',
        payload: tool
      })
    }

    return sortSlashSuggestionItems(items)
  })

  const refreshAcpCommands = async () => {
    const sessionId = options.sessionId.value
    const isAcpSession = options.isAcpSession.value
    const fetchSeq = ++acpCommandFetchSeq.value

    if (!sessionId || !isAcpSession) {
      acpCommands.value = []
      return
    }

    try {
      const commands = await newAgentPresenter.getAcpSessionCommands(sessionId)
      if (fetchSeq !== acpCommandFetchSeq.value) {
        return
      }
      if (options.sessionId.value !== sessionId || options.isAcpSession.value !== isAcpSession) {
        return
      }
      acpCommands.value = normalizeAcpCommands(commands)
    } catch (error) {
      if (fetchSeq !== acpCommandFetchSeq.value) {
        return
      }
      console.warn('[ChatInputMentions] Failed to fetch ACP session commands:', error)
      acpCommands.value = []
    }
  }

  const activateSkill = async (skillName: string) => {
    if (!skillName) return

    const sessionId = options.sessionId.value
    if (!sessionId) {
      if (!pendingSkills.value.includes(skillName)) {
        pendingSkills.value = [...pendingSkills.value, skillName]
        notifyPendingSkills()
      }
      return
    }

    const activeSkills = await skillPresenter.getActiveSkills(sessionId)
    if (activeSkills.includes(skillName)) {
      return
    }

    await skillPresenter.setActiveSkills(sessionId, [...activeSkills, skillName])
  }

  const insertPromptText = async (prompt: PromptListEntry, args?: Record<string, string>) => {
    try {
      const result = await mcpStore.getPrompt(prompt, args)
      const text = flattenPromptResultToText(result)
      if (!text) return
      options.getEditor()?.chain().focus().insertContent(` ${text} `).run()
    } catch (error) {
      console.error('[ChatInputMentions] Failed to resolve prompt content:', error)
    }
  }

  const handleSlashSelection = async (editor: Editor, range: Range, item: SlashSuggestionItem) => {
    const action = resolveSlashSelectionAction(item)

    if (action.kind === 'send-command') {
      editor.chain().focus().insertContentAt(range, '').run()
      options.onCommandSubmit(action.command)
      return
    }

    if (action.kind === 'request-command-input') {
      editor.chain().focus().insertContentAt(range, '').run()
      pendingCommand.value = action.command
      dialogState.value = {
        mode: 'command',
        title: `/${action.command.name}`,
        description: action.command.description || action.command.input?.hint || '',
        fields: [
          {
            name: 'input',
            label: 'Input',
            description: action.command.input?.hint,
            placeholder: action.command.input?.hint,
            required: true
          }
        ],
        confirmText: 'Send'
      }
      return
    }

    if (action.kind === 'activate-skill') {
      editor.chain().focus().insertContentAt(range, '').run()
      await activateSkill(action.skillName)
      return
    }

    if (action.kind === 'insert-tool') {
      editor.chain().focus().insertContentAt(range, action.text).run()
      return
    }

    if (action.kind === 'request-prompt-args') {
      editor.chain().focus().insertContentAt(range, '').run()
      pendingPrompt.value = action.prompt
      dialogState.value = {
        mode: 'prompt',
        title: `/${action.prompt.name}`,
        description: action.prompt.description || 'Fill prompt arguments before insertion.',
        fields: (action.prompt.arguments ?? []).map((arg) => ({
          name: arg.name,
          label: arg.name,
          description: arg.description,
          placeholder: arg.description,
          required: Boolean(arg.required)
        })),
        confirmText: 'Insert'
      }
      return
    }

    editor.chain().focus().insertContentAt(range, '').run()
    await insertPromptText(action.prompt)
  }

  const submitDialog = async (values: Record<string, string>) => {
    if (!dialogState.value) {
      return
    }

    if (dialogState.value.mode === 'command' && pendingCommand.value) {
      const input = values.input ?? ''
      options.onCommandSubmit(buildCommandText(pendingCommand.value.name, input))
      closeDialog()
      return
    }

    if (dialogState.value.mode === 'prompt' && pendingPrompt.value) {
      const args: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        const normalized = value.trim()
        if (normalized) {
          args[key] = normalized
        }
      }
      await insertPromptText(pendingPrompt.value, args)
      closeDialog()
      return
    }

    closeDialog()
  }

  const filterSlashItems = (query: string): SlashSuggestionItem[] => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return slashItems.value.slice(0, 20)
    }

    return slashItems.value
      .filter((item) => {
        if (item.label.toLowerCase().includes(normalized)) return true
        return item.description?.toLowerCase().includes(normalized)
      })
      .slice(0, 20)
  }

  const createRenderer = () => {
    let component: VueRenderer | null = null
    let popup: ReturnType<typeof tippy> | null = null

    return {
      onStart: (props: any) => {
        isSuggestionMenuOpen.value = true
        component = new VueRenderer(SuggestionList, {
          editor: props.editor,
          props: {
            items: props.items,
            query: props.query,
            command: (item: SuggestionItem) => props.command(item)
          }
        })

        if (!props.clientRect) {
          return
        }

        popup = (tippy as any)('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'top-start',
          zIndex: 90
        })
      },
      onUpdate: (props: any) => {
        component?.updateProps({
          items: props.items,
          query: props.query,
          command: (item: SuggestionItem) => props.command(item)
        })

        if (!props.clientRect || !popup?.[0]) {
          return
        }

        popup[0].setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown: (props: any) => {
        if (!popup?.[0]) {
          return false
        }

        if (props.event.key === 'Escape') {
          popup[0].hide()
          return true
        }

        return component?.ref?.onKeyDown(props) ?? false
      },
      onExit: () => {
        isSuggestionMenuOpen.value = false
        popup?.[0]?.destroy()
        popup = null
        component?.destroy()
        component = null
      }
    }
  }

  const atSuggestion = {
    char: '@',
    allowedPrefixes: null,
    items: async ({ query }: { query: string }) => {
      return await searchWorkspaceFiles(query)
    },
    command: ({
      editor,
      range,
      props
    }: {
      editor: Editor
      range: Range
      props: FileSuggestionItem
    }) => {
      markSuggestionSelected()
      editor.chain().focus().insertContentAt(range, props.payload.insertText).run()
    },
    render: createRenderer
  }

  const slashSuggestion = {
    char: '/',
    allowedPrefixes: null,
    items: ({ query }: { query: string }) => filterSlashItems(query),
    command: ({
      editor,
      range,
      props
    }: {
      editor: Editor
      range: Range
      props: SlashSuggestionItem
    }) => {
      markSuggestionSelected()
      void handleSlashSelection(editor, range, props)
    },
    render: createRenderer
  }

  const handleAcpCommandsReady = (_event: unknown, payload?: Record<string, unknown>) => {
    if (!payload) return
    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : ''
    if (!conversationId || conversationId !== options.sessionId.value) {
      return
    }
    acpCommands.value = normalizeAcpCommands(payload.commands)
  }

  watch(
    () => options.workspacePath.value,
    (workspacePath) => {
      if (!workspacePath || workspacePath !== registeredWorkspacePath.value) {
        registeredWorkspacePath.value = null
      }
    }
  )

  watch(
    () => options.sessionId.value,
    (sessionId) => {
      if (sessionId) {
        pendingSkills.value = []
        notifyPendingSkills()
      }
    }
  )

  watch(
    () => [options.sessionId.value, options.isAcpSession.value] as const,
    () => {
      void refreshAcpCommands()
    },
    { immediate: true }
  )

  onMounted(() => {
    if (skillsStore.skills.length === 0) {
      void skillsStore.loadSkills()
    }
    void mcpStore.loadPrompts()
    void mcpStore.loadTools()

    window.electron.ipcRenderer.on(
      ACP_WORKSPACE_EVENTS.SESSION_COMMANDS_READY,
      handleAcpCommandsReady
    )
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.removeListener(
      ACP_WORKSPACE_EVENTS.SESSION_COMMANDS_READY,
      handleAcpCommandsReady
    )
  })

  return {
    atSuggestion,
    slashSuggestion,
    isSuggestionMenuOpen,
    shouldSuppressSubmit,
    pendingSkills,
    dialogState,
    submitDialog,
    closeDialog
  }
}
