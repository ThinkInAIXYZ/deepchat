import { computed, onMounted, onUnmounted, ref, toRaw, useId, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueRenderer } from '@tiptap/vue-3'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { exitSuggestion } from '@tiptap/suggestion'
import tippy from 'tippy.js'
import { createSessionClient } from '@api/SessionClient'
import { createWorkspaceClient } from '@api/WorkspaceClient'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import type { WorkspaceFileNode } from '@shared/types/workspace'
import type { PromptListEntry } from '@shared/types/mcp'
import type { SessionReference } from '@shared/sessionReferences'
import { useMcpStore } from '@/stores/mcp'
import { useSkillsStore } from '@/stores/skillsStore'
import { resolveChatInputWorkspaceReferencePath } from '@/lib/chatInputWorkspaceReference'
import SuggestionList from '../mentions/SuggestionList.vue'
import {
  buildCommandText,
  createManualCompactionSuggestion,
  filterSlashSuggestionItems,
  flattenPromptResultToText,
  resolveSlashSelectionAction,
  shouldShowManualCompactionCommand,
  sortSlashSuggestionItems,
  type AcpSessionCommand,
  type SlashSuggestionItem
} from '../mentions/utils'

import type { SkillMetadata } from '@shared/types/skill'

export interface UseChatInputMentionsOptions {
  skills?: Ref<SkillMetadata[]>
  getEditor: () => Editor | null
  workspacePath: Ref<string | null>
  sessionId: Ref<string | null>
  agentId: Ref<string | null>
  isAcpSession: Ref<boolean>
  isGenerating?: Ref<boolean>
  compactCommandDescription?: Ref<string>
  resolveSessionReference: (
    sessionId: string,
    insert: (reference: SessionReference) => void
  ) => Promise<void>
  onCommandSubmit: (command: string) => void
  onActivateSkill: (skillName: string) => Promise<void> | void
}

interface FileSuggestionItem {
  id: string
  category: 'file'
  label: string
  description?: string
  payload: { path: string; relativePath: string }
}

interface SessionSuggestionItem {
  id: string
  category: 'session'
  label: string
  description: string
  payload: { sessionId: string }
}

type AtSuggestionItem = FileSuggestionItem | SessionSuggestionItem
type SuggestionItem = AtSuggestionItem | SlashSuggestionItem

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
  const { t } = useI18n()
  const suggestionListId = useId()
  const referenceSuggestionKey = new PluginKey('chatInputReferences')
  const activeSuggestionId = ref<string | null>(null)
  const workspaceClient = createWorkspaceClient()
  const sessionClient = createSessionClient()
  const mcpStore = useMcpStore()
  const skillsStore = useSkillsStore()

  const acpCommands = ref<AcpSessionCommand[]>([])
  const acpCommandFetchSeq = ref(0)
  const isSuggestionMenuOpen = ref(false)
  const suggestionItemCount = ref(0)
  const suggestionLoading = ref(false)
  const referenceSearchFailed = ref(false)
  let referenceSearchSequence = 0
  let referenceItems = new Set<AtSuggestionItem>()
  // Reserve Enter/Tab while results are loading or selectable, so choosing a reference cannot
  // accidentally submit the draft. An empty, settled menu leaves send/queue shortcuts available.
  const hasSelectableSuggestions = computed(
    () => isSuggestionMenuOpen.value && (suggestionLoading.value || suggestionItemCount.value > 0)
  )
  const suggestionAttributes = computed<Record<string, string>>(() => {
    if (!isSuggestionMenuOpen.value) return {}
    return {
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-controls': suggestionListId,
      ...(activeSuggestionId.value
        ? { 'aria-activedescendant': activeSuggestionId.value }
        : { 'aria-describedby': `${suggestionListId}-status` })
    }
  })
  const suppressSubmitUntil = ref(0)
  const registeredWorkspacePath = ref<string | null>(null)
  const normalizedAgentId = computed(() => options.agentId.value?.trim() || 'deepchat')
  let unsubscribeAcpCommandsReady: (() => void) | null = null

  // Stores the pending command/prompt context for the inline CommandForm
  const pendingFormData = ref<{
    type: 'command' | 'prompt'
    command?: AcpSessionCommand
    prompt?: PromptListEntry
  } | null>(null)

  const shouldSuppressSubmit = () => Date.now() < suppressSubmitUntil.value
  const markSuggestionSelected = () => {
    suppressSubmitUntil.value = Date.now() + 180
  }

  const closeDialog = () => {
    pendingFormData.value = null
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
      await workspaceClient.registerWorkspace(
        workspacePath,
        options.isAcpSession.value ? 'workdir' : 'workspace'
      )
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
      throw new Error('Workspace registration failed')
    }

    try {
      const searchQuery = query.trim() || '**/*'
      const result =
        (await workspaceClient.searchFiles(workspacePath, searchQuery)) ??
        ([] as WorkspaceFileNode[])

      return result.slice(0, 20).map((file) => {
        const displayPath = resolveChatInputWorkspaceReferencePath(
          file.path,
          workspacePath,
          file.name
        )
        return {
          id: `file:${file.path}`,
          category: 'file' as const,
          label: file.name,
          description: displayPath,
          payload: {
            path: file.path,
            relativePath: displayPath
          }
        }
      })
    } catch (error) {
      console.warn('[ChatInputMentions] searchFiles failed:', error)
      throw error
    }
  }

  const searchSessions = async (query: string): Promise<SessionSuggestionItem[]> => {
    if (options.isAcpSession.value) return []
    const sessionId = options.sessionId.value
    const projectDir = options.workspacePath.value
    try {
      const result = await sessionClient.searchReferenceCandidates({
        projectDir,
        query,
        ...(sessionId ? { excludeSessionId: sessionId } : {})
      })
      return result.items.map((item) => ({
        id: `session:${item.sessionId}`,
        category: 'session' as const,
        label: item.title,
        description: `${item.agentId} · ${new Date(item.updatedAt).toLocaleString()}`,
        payload: { sessionId: item.sessionId }
      }))
    } catch (error) {
      console.warn('[ChatInputMentions] searchReferenceCandidates failed:', error)
      throw error
    }
  }

  const slashItems = computed<SlashSuggestionItem[]>(() => {
    const items: SlashSuggestionItem[] = []
    if (
      shouldShowManualCompactionCommand({
        sessionId: options.sessionId.value,
        isAcpSession: options.isAcpSession.value,
        isGenerating: options.isGenerating?.value
      })
    ) {
      items.push(createManualCompactionSuggestion(options.compactCommandDescription?.value ?? ''))
    }

    for (const command of acpCommands.value) {
      items.push({
        id: `command:${command.name}`,
        category: 'command',
        label: `/${command.name}`,
        description: command.description || command.input?.hint || '',
        payload: command
      })
    }

    for (const skill of options.skills?.value ??
      skillsStore.getSkillsForAgent(normalizedAgentId.value)) {
      items.push({
        id: `skill:${skill.name}`,
        category: 'skill',
        label: skill.name,
        description: skill.description,
        payload: { name: skill.name }
      })
    }

    for (const prompt of mcpStore.visiblePrompts) {
      items.push({
        id: `prompt:${prompt.client?.name || 'unknown'}:${prompt.name}`,
        category: 'prompt',
        label: prompt.name,
        description: prompt.description || '',
        payload: prompt
      })
    }

    for (const tool of mcpStore.visibleTools) {
      items.push({
        id: `tool:${tool.server.name}:${tool.function.name ?? ''}`,
        category: 'tool',
        label: tool.function.name ?? '',
        description: tool.function.description || '',
        payload: tool
      })
    }

    for (const tool of mcpStore.pluginTools) {
      items.push({
        id: `plugin-tool:${tool.server.name}:${tool.function.name ?? ''}`,
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
      const commands = await sessionClient.getAcpSessionCommands(sessionId)
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

  /** Insert a CommandForm block node at the given range */
  function insertCommandFormNode(editor: Editor, range: Range, attrs: Record<string, unknown>) {
    // Clear the trigger text first, then insert the form node at the same position
    editor
      .chain()
      .focus()
      .insertContentAt(range, '')
      .insertContentAt(range.from, {
        type: 'commandForm',
        attrs
      })
      .run()
  }

  const handleSlashSelection = async (editor: Editor, range: Range, item: SlashSuggestionItem) => {
    const action = resolveSlashSelectionAction(item)

    if (action.kind === 'send-command') {
      editor.chain().focus().insertContentAt(range, '').run()
      options.onCommandSubmit(action.command)
      return
    }

    if (action.kind === 'request-command-input') {
      pendingFormData.value = { type: 'command', command: action.command }
      insertCommandFormNode(editor, range, {
        mode: 'command',
        commandName: action.command.name,
        description: action.command.description || action.command.input?.hint || '',
        confirmText: 'Send',
        fields: JSON.stringify([
          {
            name: 'input',
            label: 'Input',
            description: action.command.input?.hint,
            placeholder: action.command.input?.hint,
            required: true
          }
        ])
      })
      return
    }

    if (action.kind === 'activate-skill') {
      editor.chain().focus().insertContentAt(range, '').run()
      await options.onActivateSkill(action.skillName)
      return
    }

    if (action.kind === 'insert-tool') {
      editor.chain().focus().insertContentAt(range, action.text).run()
      return
    }

    if (action.kind === 'request-prompt-args') {
      pendingFormData.value = { type: 'prompt', prompt: action.prompt }
      insertCommandFormNode(editor, range, {
        mode: 'prompt',
        commandName: action.prompt.name,
        description: action.prompt.description || 'Fill prompt arguments before insertion.',
        confirmText: 'Insert',
        fields: JSON.stringify(
          (action.prompt.arguments ?? []).map((arg) => ({
            name: arg.name,
            label: arg.name,
            description: arg.description,
            placeholder: arg.description,
            required: Boolean(arg.required)
          }))
        )
      })
      return
    }

    editor.chain().focus().insertContentAt(range, '').run()
    await insertPromptText(action.prompt)
  }

  const submitDialog = async (values: Record<string, string>) => {
    const data = pendingFormData.value
    if (!data) return

    if (data.type === 'command' && data.command) {
      const input = values.input ?? ''
      options.onCommandSubmit(buildCommandText(data.command.name, input))
      closeDialog()
      return
    }

    if (data.type === 'prompt' && data.prompt) {
      const args: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        const normalized = value.trim()
        if (normalized) {
          args[key] = normalized
        }
      }
      await insertPromptText(data.prompt, args)
      closeDialog()
      return
    }

    closeDialog()
  }

  const filterSlashItems = (query: string): SlashSuggestionItem[] => {
    return filterSlashSuggestionItems(slashItems.value, query)
  }

  const createRenderer = (isReference = false) => {
    let component: VueRenderer | null = null
    let popup: ReturnType<typeof tippy> | null = null
    const statusLabel = () =>
      suggestionLoading.value
        ? t('common.loading')
        : isReference && referenceSearchFailed.value
          ? t('chat.search.error')
          : isReference && !options.workspacePath.value
            ? t('chat.workspace.files.noWorkspace.description')
            : ''

    const syncAvailability = (props: any) => {
      suggestionItemCount.value = Array.isArray(props?.items) ? props.items.length : 0
      suggestionLoading.value = props?.loading === true
    }

    const close = () => {
      isSuggestionMenuOpen.value = false
      suggestionItemCount.value = 0
      suggestionLoading.value = false
      activeSuggestionId.value = null
      popup?.[0]?.destroy()
      popup = null
      component?.destroy()
      component = null
    }
    return {
      onStart: (props: any) => {
        isSuggestionMenuOpen.value = true
        syncAvailability(props)
        component = new VueRenderer(SuggestionList, {
          editor: props.editor,
          props: {
            listId: suggestionListId,
            label: t('chat.input.suggestions'),
            emptyLabel: t('chat.spotlight.emptyTitle'),
            statusLabel: statusLabel(),
            onActiveChange: (id: string | null) => {
              activeSuggestionId.value = id
            },
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
          role: '',
          aria: { content: null, expanded: false },
          placement: 'top-start',
          zIndex: 90
        })
      },
      onUpdate: (props: any) => {
        syncAvailability(props)
        component?.updateProps({
          items: props.items,
          query: props.query,
          statusLabel: statusLabel(),
          command: (item: SuggestionItem) => props.command(item)
        })

        if (!props.clientRect || !popup?.[0]) {
          return
        }

        popup[0].setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown: (props: any) => {
        const event = props.event as KeyboardEvent
        if (event.isComposing || event.keyCode === 229 || props.view?.composing) return false
        if (!popup?.[0]) {
          return false
        }

        if (props.event.key === 'Escape') {
          close()
          return true
        }

        if (
          suggestionLoading.value &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key === 'Enter' || event.key === 'Tab')
        ) {
          event.preventDefault()
          return true
        }

        return component?.ref?.onKeyDown(props) ?? false
      },
      onExit: close
    }
  }

  const atSuggestion = {
    pluginKey: referenceSuggestionKey,
    char: '@',
    allowedPrefixes: [' ', '\n'],
    items: async ({ query }: { query: string }) => {
      const sequence = ++referenceSearchSequence
      referenceItems.clear()
      referenceSearchFailed.value = false
      const results = await Promise.allSettled([searchWorkspaceFiles(query), searchSessions(query)])
      if (sequence !== referenceSearchSequence) return []
      referenceSearchFailed.value = results.some((result) => result.status === 'rejected')
      const items = results.flatMap<AtSuggestionItem>((result) =>
        result.status === 'fulfilled' ? result.value : []
      )
      referenceItems = new Set(items)
      return items
    },
    command: ({
      editor,
      range,
      props
    }: {
      editor: Editor
      range: Range
      props: AtSuggestionItem
    }) => {
      if (!editor.isEditable || !referenceItems.has(toRaw(props))) return
      markSuggestionSelected()
      if (props.category === 'file') {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'fileReference',
              attrs: { filePath: props.payload.path, relativePath: props.payload.relativePath }
            },
            { type: 'text', text: ' ' }
          ])
          .run()
        return
      }

      void options
        .resolveSessionReference(props.payload.sessionId, (reference) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, { type: 'sessionReference', attrs: reference })
            .run()
        })
        .catch((error) => {
          console.warn('[ChatInputMentions] resolveReference failed:', error)
          notifyRenderer({
            kind: 'error',
            code: 'chat.sessionReference.unavailable',
            title: t('chat.sessionReference.unavailableTitle'),
            description: t('chat.sessionReference.unavailableDescription')
          })
        })
    },
    render: () => createRenderer(true)
  }

  const slashSuggestion = {
    char: '/',
    // Slash commands are only valid at a command position: the start of the input or after a
    // space. Allowing any preceding character (`allowedPrefixes: null`) made the trailing
    // `/lody` of a URL, or a `src/main/index.ts` path, open the menu and swallow Enter.
    allowedPrefixes: [' '],
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

  const handleAcpCommandsReady = (payload?: Record<string, unknown>) => {
    if (!payload) return
    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : ''
    if (!conversationId || conversationId !== options.sessionId.value) {
      return
    }
    acpCommands.value = normalizeAcpCommands(payload.commands)
  }

  watch(
    () => [
      options.sessionId.value,
      options.workspacePath.value,
      options.agentId.value,
      options.isAcpSession.value
    ],
    () => {
      referenceSearchSequence += 1
      referenceItems.clear()
      const editor = options.getEditor()
      if (editor && !editor.isDestroyed) exitSuggestion(editor.view, referenceSuggestionKey)
    },
    { flush: 'sync' }
  )

  watch(
    () => options.workspacePath.value,
    (workspacePath) => {
      if (!workspacePath || workspacePath !== registeredWorkspacePath.value) {
        registeredWorkspacePath.value = null
      }
    }
  )

  watch(
    normalizedAgentId,
    (nextAgentId, previousAgentId) => {
      if (previousAgentId && previousAgentId !== nextAgentId) {
        closeDialog()
      }
      if (!options.skills) void skillsStore.ensureSkillsLoaded(nextAgentId)
    },
    { immediate: true }
  )

  watch(
    () => [options.sessionId.value, options.isAcpSession.value] as const,
    () => {
      void refreshAcpCommands()
    },
    { immediate: true }
  )

  onMounted(() => {
    void mcpStore.loadPrompts()
    void mcpStore.loadTools()

    unsubscribeAcpCommandsReady = sessionClient.onAcpCommandsReady(handleAcpCommandsReady)
  })

  onUnmounted(() => {
    referenceSearchSequence += 1
    referenceItems.clear()
    unsubscribeAcpCommandsReady?.()
    unsubscribeAcpCommandsReady = null
  })

  return {
    atSuggestion,
    slashSuggestion,
    isSuggestionMenuOpen,
    hasSelectableSuggestions,
    suggestionAttributes,
    shouldSuppressSubmit,
    submitDialog,
    closeDialog
  }
}
