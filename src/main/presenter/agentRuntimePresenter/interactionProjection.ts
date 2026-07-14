import type {
  AssistantMessageBlock,
  MessageFile,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import type { LoopRun } from '@/agent/deepchat/loop/loopRun'
import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { PendingToolInteraction } from './types'
import { normalizeStringList } from '@/agent/deepchat/resources/systemPromptBuilder'

export type PendingInteractionEntry = {
  interaction: PendingToolInteraction
  blockIndex: number
}

export type ProviderPermissionInteractionInput = {
  sessionId: string
  messageId: string
  toolCallId: string
  requestId: string
  permissionType: 'read' | 'write' | 'all' | 'command'
  granted: boolean
  ownerRun?: LoopRun<unknown>
  signal?: AbortSignal
}

export type ProviderPermissionProjection =
  | { status: 'resolved'; granted: boolean }
  | { status: 'error'; message: string }

export type SkillDraftStatus = 'pending' | 'viewed' | 'installed' | 'discarded' | 'error'
export type SkillDraftChoice = 'view' | 'install' | 'discard'

export const SKILL_DRAFT_ACTION_LABELS: Record<SkillDraftChoice, string> = {
  view: 'chat.skillDraft.actions.view',
  install: 'chat.skillDraft.actions.install',
  discard: 'chat.skillDraft.actions.discard'
}

export const SKILL_DRAFT_STATUS_BY_CHOICE: Record<
  Exclude<SkillDraftChoice, 'view'>,
  SkillDraftStatus
> = {
  install: 'installed',
  discard: 'discarded'
}

export function resolveSkillDraftChoice(answerText: string): SkillDraftChoice | null {
  const normalized = answerText.trim()
  for (const [choice, label] of Object.entries(SKILL_DRAFT_ACTION_LABELS) as Array<
    [SkillDraftChoice, string]
  >) {
    if (normalized === choice || normalized === label) {
      return choice
    }
  }
  return null
}

export function isSkillDraftConfirmationBlock(block: AssistantMessageBlock): boolean {
  return (
    block.action_type === 'question_request' &&
    block.extra?.skillDraftAction === 'confirm' &&
    typeof block.extra?.skillDraftId === 'string'
  )
}

export function updateSkillDraftQuestionOptions(
  block: AssistantMessageBlock,
  viewed: boolean
): void {
  const options = [
    ...(viewed
      ? []
      : [
          {
            label: SKILL_DRAFT_ACTION_LABELS.view,
            description: 'chat.skillDraft.actions.viewDescription'
          }
        ]),
    {
      label: SKILL_DRAFT_ACTION_LABELS.install,
      description: 'chat.skillDraft.actions.installDescription'
    },
    {
      label: SKILL_DRAFT_ACTION_LABELS.discard,
      description: 'chat.skillDraft.actions.discardDescription'
    }
  ]
  block.extra = {
    ...block.extra,
    questionOptions: options
  }
}

export function updateSkillDraftToolCallResponse(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  responseText: string,
  isError: boolean
): void {
  updateToolCallResponse(blocks, toolCallId, responseText, isError)
}

export function buildSkillDraftToolResponse(result: {
  success: boolean
  action: SkillDraftChoice
  draftId: string
  skillName?: string
  installedSkillName?: string
  error?: string
}): string {
  if (!result.success) {
    return JSON.stringify({
      success: false,
      action: result.action,
      draftId: result.draftId,
      error: result.error || 'Unknown error'
    })
  }

  return JSON.stringify({
    success: true,
    action: result.action,
    draftId: result.draftId,
    ...(result.skillName ? { skillName: result.skillName } : {}),
    ...(result.installedSkillName ? { installedSkillName: result.installedSkillName } : {})
  })
}

export function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function extractUserMessageInput(content: string): SendMessageInput {
  const fallback: SendMessageInput = { text: '', files: [] }

  try {
    const parsed = JSON.parse(content) as UserMessageContent | SendMessageInput | string
    if (typeof parsed === 'string') {
      return { text: parsed, files: [] }
    }
    if (!parsed || typeof parsed !== 'object') {
      return fallback
    }

    const text = typeof parsed.text === 'string' ? parsed.text : ''
    const files = Array.isArray((parsed as { files?: unknown }).files)
      ? ((parsed as { files?: unknown }).files as MessageFile[]).filter((file) => Boolean(file))
      : []
    const activeSkills = normalizeStringList(
      Array.isArray((parsed as { activeSkills?: unknown }).activeSkills)
        ? ((parsed as { activeSkills?: unknown }).activeSkills as string[])
        : []
    )
    const inlineItems: NonNullable<SendMessageInput['inlineItems']> = Array.isArray(
      (parsed as { inlineItems?: unknown }).inlineItems
    )
      ? ((parsed as { inlineItems?: unknown }).inlineItems as NonNullable<
          SendMessageInput['inlineItems']
        >)
      : []
    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  } catch {
    return { text: content, files: [] }
  }
}

export function normalizeUserMessageInput(input: string | SendMessageInput): SendMessageInput {
  if (typeof input === 'string') {
    return { text: input, files: [] }
  }
  if (!input || typeof input !== 'object') {
    return { text: '', files: [] }
  }
  const text = typeof input.text === 'string' ? input.text : ''
  const files = Array.isArray(input.files)
    ? input.files.filter((file): file is MessageFile => Boolean(file))
    : []
  const activeSkills = normalizeStringList(
    Array.isArray(input.activeSkills) ? input.activeSkills : []
  )
  const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
  return {
    text,
    files,
    ...(activeSkills.length > 0 ? { activeSkills } : {}),
    ...(inlineItems.length > 0 ? { inlineItems } : {})
  }
}

export function buildEditedUserContent(rawContent: string, text: string): string {
  const fallback: UserMessageContent = {
    text,
    files: [],
    links: [],
    search: false,
    think: false
  }

  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown> | string
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return JSON.stringify(fallback)
    }

    const next = { ...parsed, text } as Record<string, unknown>
    delete next.inlineItems

    if (!Array.isArray(next.files)) {
      next.files = []
    }
    if (!Array.isArray(next.links)) {
      next.links = []
    }
    if (typeof next.search !== 'boolean') {
      next.search = false
    }
    if (typeof next.think !== 'boolean') {
      next.think = false
    }

    if (Array.isArray(next.content)) {
      let replaced = false
      const mapped = next.content.map((item) => {
        if (
          !replaced &&
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as { type?: unknown }).type === 'text'
        ) {
          replaced = true
          return { ...(item as Record<string, unknown>), content: text }
        }
        return item
      })

      if (!replaced) {
        mapped.unshift({ type: 'text', content: text })
      }
      next.content = mapped
    }

    if (Array.isArray(next.inlineItems)) {
      delete next.inlineItems
    }

    return JSON.stringify(next)
  } catch {
    return JSON.stringify(fallback)
  }
}

export function collectPendingInteractionEntries(
  messageId: string,
  blocks: AssistantMessageBlock[],
  orderOffset = 0
): PendingInteractionEntry[] {
  const entries: PendingInteractionEntry[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (
      block.type !== 'action' ||
      (block.action_type !== 'tool_call_permission' && block.action_type !== 'question_request') ||
      block.status !== 'pending' ||
      block.extra?.needsUserAction === false
    ) {
      continue
    }

    const toolCallId = block.tool_call?.id
    if (!toolCallId) {
      continue
    }

    const toolName = block.tool_call?.name || ''
    const toolArgs = block.tool_call?.params || ''

    if (block.action_type === 'question_request') {
      entries.push({
        blockIndex: index,
        interaction: {
          type: 'question',
          origin: isSkillDraftConfirmationBlock(block) ? 'skill-draft-confirmation' : 'question',
          order: orderOffset + entries.length,
          messageId,
          toolCallId,
          toolName,
          toolArgs,
          serverName: block.tool_call?.server_name,
          serverIcons: block.tool_call?.server_icons,
          serverDescription: block.tool_call?.server_description,
          question: {
            header:
              typeof block.extra?.questionHeader === 'string' ? block.extra.questionHeader : '',
            question: typeof block.extra?.questionText === 'string' ? block.extra.questionText : '',
            options: parseQuestionOptions(block.extra?.questionOptions),
            custom: block.extra?.questionCustom !== false,
            multiple: Boolean(block.extra?.questionMultiple)
          }
        }
      })
      continue
    }

    entries.push({
      blockIndex: index,
      interaction: {
        type: 'permission',
        origin:
          parsePermissionPayload(block)?.providerId?.trim() === 'acp'
            ? 'acp-permission'
            : 'pre-check-permission',
        order: orderOffset + entries.length,
        messageId,
        toolCallId,
        toolName,
        toolArgs,
        serverName: block.tool_call?.server_name,
        serverIcons: block.tool_call?.server_icons,
        serverDescription: block.tool_call?.server_description,
        permission: parsePermissionPayload(block)
      }
    })
  }

  return entries
}

export function replacePendingInteractions(
  instance: DeepChatAgentInstance,
  entries: readonly PendingInteractionEntry[]
): void {
  instance.replacePendingInteractions(
    entries.map(({ interaction }) => ({
      messageId: interaction.messageId,
      toolCallId: interaction.toolCallId,
      origin: interaction.origin,
      order: interaction.order
    }))
  )
}

export function reconcilePendingInteractionEntries(
  instance: DeepChatAgentInstance,
  entries: PendingInteractionEntry[]
): PendingInteractionEntry[] {
  const knownInteractions = instance.getPendingInteractions()
  for (const entry of entries) {
    const known = knownInteractions.find(
      (interaction) =>
        interaction.messageId === entry.interaction.messageId &&
        interaction.toolCallId === entry.interaction.toolCallId
    )
    if (known) {
      entry.interaction.origin = known.origin
      entry.interaction.order = known.order
    }
  }
  return entries.sort((left, right) => left.interaction.order - right.interaction.order)
}

export function parseQuestionOptions(raw: unknown): Array<{ label: string; description?: string }> {
  const parseOption = (value: unknown): { label: string; description?: string } | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { label?: unknown; description?: unknown }
    if (typeof candidate.label !== 'string') return null
    const label = candidate.label.trim()
    if (!label) return null
    if (typeof candidate.description === 'string' && candidate.description.trim()) {
      return { label, description: candidate.description.trim() }
    }
    return { label }
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => parseOption(item))
      .filter((item): item is { label: string; description?: string } => Boolean(item))
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => parseOption(item))
          .filter((item): item is { label: string; description?: string } => Boolean(item))
      }
    } catch {
      return []
    }
  }
  return []
}

export function parsePermissionPayload(
  block: AssistantMessageBlock
): PendingToolInteraction['permission'] | undefined {
  const rawPayload = block.extra?.permissionRequest
  if (typeof rawPayload === 'string' && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload) as PendingToolInteraction['permission']
      if (parsed && typeof parsed === 'object') {
        return {
          ...parsed,
          permissionType:
            parsed.permissionType === 'read' ||
            parsed.permissionType === 'write' ||
            parsed.permissionType === 'all' ||
            parsed.permissionType === 'command'
              ? parsed.permissionType
              : 'write'
        }
      }
    } catch {
      // ignore parsing failure
    }
  }

  const permissionType = block.extra?.permissionType
  return {
    permissionType:
      permissionType === 'read' ||
      permissionType === 'write' ||
      permissionType === 'all' ||
      permissionType === 'command'
        ? permissionType
        : 'write',
    description: typeof block.content === 'string' ? block.content : '',
    toolName:
      typeof block.extra?.toolName === 'string' ? block.extra.toolName : block.tool_call?.name,
    serverName:
      typeof block.extra?.serverName === 'string'
        ? block.extra.serverName
        : block.tool_call?.server_name,
    providerId: typeof block.extra?.providerId === 'string' ? block.extra.providerId : undefined,
    requestId:
      typeof block.extra?.permissionRequestId === 'string'
        ? block.extra.permissionRequestId
        : undefined
  }
}

export function applyProviderPermissionProjection(
  blocks: AssistantMessageBlock[],
  input: ProviderPermissionInteractionInput,
  projection: ProviderPermissionProjection
): boolean {
  const actionBlock = blocks.find(
    (block) =>
      block.type === 'action' &&
      block.action_type === 'tool_call_permission' &&
      block.tool_call?.id === input.toolCallId &&
      (block.extra?.permissionRequestId === input.requestId || input.requestId === '')
  )

  if (!actionBlock) {
    return false
  }

  if (projection.status === 'resolved') {
    markPermissionResolved(actionBlock, projection.granted, input.permissionType)
    return true
  }

  actionBlock.status = 'error'
  actionBlock.content = projection.message
  actionBlock.extra = {
    ...actionBlock.extra,
    needsUserAction: false
  }
  updateToolCallResponse(blocks, input.toolCallId, projection.message, true)
  return true
}

export function markQuestionResolved(
  block: AssistantMessageBlock,
  answerText: string,
  awaitsUserFollowUp = false
): void {
  block.status = 'success'
  block.extra = {
    ...block.extra,
    needsUserAction: false,
    questionResolution: 'replied',
    questionFollowUpPending: awaitsUserFollowUp,
    ...(answerText ? { answerText } : {})
  }
}

export function hasQuestionFollowUpIntent(blocks: AssistantMessageBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.type === 'action' &&
      block.action_type === 'question_request' &&
      block.status === 'success' &&
      block.extra?.needsUserAction === false &&
      block.extra?.questionResolution === 'replied' &&
      block.extra?.questionFollowUpPending === true
  )
}

export function markPermissionResolved(
  block: AssistantMessageBlock,
  granted: boolean,
  permissionType: 'read' | 'write' | 'all' | 'command'
): void {
  block.status = granted ? 'granted' : 'denied'
  block.extra = {
    ...block.extra,
    needsUserAction: false,
    ...(granted ? { grantedPermissions: permissionType } : {})
  }
  if (!granted) {
    block.content = 'User denied the request.'
  }
}

export function updateToolCallResponse(
  blocks: AssistantMessageBlock[],
  toolCallId: string,
  responseText: string,
  isError: boolean,
  rtkMetadata?: {
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
    imagePreviews?: ToolCallImagePreview[]
  }
): void {
  const toolBlock = blocks.find(
    (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
  )
  if (!toolBlock?.tool_call) return
  toolBlock.tool_call.response = responseText
  if (typeof rtkMetadata?.rtkApplied === 'boolean') {
    toolBlock.tool_call.rtkApplied = rtkMetadata.rtkApplied
  }
  if (rtkMetadata?.rtkMode) {
    toolBlock.tool_call.rtkMode = rtkMetadata.rtkMode
  }
  if (rtkMetadata?.rtkFallbackReason) {
    toolBlock.tool_call.rtkFallbackReason = rtkMetadata.rtkFallbackReason
  }
  if (rtkMetadata?.imagePreviews && rtkMetadata.imagePreviews.length > 0) {
    toolBlock.tool_call.imagePreviews = rtkMetadata.imagePreviews
  } else if (rtkMetadata?.imagePreviews) {
    delete toolBlock.tool_call.imagePreviews
  }
  toolBlock.status = isError ? 'error' : 'success'
}
