import type { AssistantMessageBlock, QuestionOption } from '@shared/types/agent-interface'
import type {
  RemotePendingInteraction,
  RemotePendingInteractionPermission,
  RemotePermissionCommandInfo
} from '../types'

type RemotePendingInteractionWithOrder = RemotePendingInteraction & {
  messageOrderSeq: number
}

const isPermissionType = (
  value: unknown
): value is RemotePendingInteractionPermission['permissionType'] =>
  value === 'read' || value === 'write' || value === 'all' || value === 'command'

const parseQuestionOption = (value: unknown): QuestionOption | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as { label?: unknown; description?: unknown }
  if (typeof candidate.label !== 'string') {
    return null
  }

  const label = candidate.label.trim()
  if (!label) {
    return null
  }

  if (typeof candidate.description === 'string' && candidate.description.trim()) {
    return {
      label,
      description: candidate.description.trim()
    }
  }

  return { label }
}

export const parseQuestionOptions = (raw: unknown): QuestionOption[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => parseQuestionOption(item))
      .filter((item): item is QuestionOption => Boolean(item))
  }

  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => parseQuestionOption(item))
          .filter((item): item is QuestionOption => Boolean(item))
      }
    } catch {
      return []
    }
  }

  return []
}

const parseCommandInfo = (raw: unknown): RemotePermissionCommandInfo | undefined => {
  const candidate =
    typeof raw === 'string' && raw.trim()
      ? (() => {
          try {
            return JSON.parse(raw) as unknown
          } catch {
            return null
          }
        })()
      : raw

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined
  }

  const value = candidate as Record<string, unknown>
  if (typeof value.command !== 'string' || !value.command.trim()) {
    return undefined
  }

  const riskLevel =
    value.riskLevel === 'low' ||
    value.riskLevel === 'medium' ||
    value.riskLevel === 'high' ||
    value.riskLevel === 'critical'
      ? value.riskLevel
      : 'medium'

  return {
    command: value.command.trim(),
    riskLevel,
    suggestion: typeof value.suggestion === 'string' ? value.suggestion.trim() : '',
    ...(typeof value.signature === 'string' && value.signature.trim()
      ? { signature: value.signature.trim() }
      : {}),
    ...(typeof value.baseCommand === 'string' && value.baseCommand.trim()
      ? { baseCommand: value.baseCommand.trim() }
      : {})
  }
}

export const parsePermissionPayload = (
  block: AssistantMessageBlock
): RemotePendingInteractionPermission | undefined => {
  const rawPayload = block.extra?.permissionRequest
  if (typeof rawPayload === 'string' && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const commandInfo = parseCommandInfo(parsed.commandInfo)
        return {
          permissionType: isPermissionType(parsed.permissionType) ? parsed.permissionType : 'write',
          description:
            typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description
              : typeof block.content === 'string'
                ? block.content
                : '',
          ...(typeof parsed.toolName === 'string' && parsed.toolName.trim()
            ? { toolName: parsed.toolName.trim() }
            : {}),
          ...(typeof parsed.serverName === 'string' && parsed.serverName.trim()
            ? { serverName: parsed.serverName.trim() }
            : {}),
          ...(typeof parsed.providerId === 'string' && parsed.providerId.trim()
            ? { providerId: parsed.providerId.trim() }
            : {}),
          ...(typeof parsed.requestId === 'string' && parsed.requestId.trim()
            ? { requestId: parsed.requestId.trim() }
            : {}),
          ...(parsed.rememberable === false ? { rememberable: false } : { rememberable: true }),
          ...(typeof parsed.command === 'string' && parsed.command.trim()
            ? { command: parsed.command }
            : {}),
          ...(typeof parsed.commandSignature === 'string' && parsed.commandSignature.trim()
            ? { commandSignature: parsed.commandSignature.trim() }
            : {}),
          ...(Array.isArray(parsed.paths)
            ? {
                paths: parsed.paths.filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0
                )
              }
            : {}),
          ...(commandInfo ? { commandInfo } : {})
        }
      }
    } catch {
      // Ignore malformed serialized permission payloads and fall back to block fields.
    }
  }

  const permissionType = block.extra?.permissionType
  const commandInfo = parseCommandInfo(block.extra?.commandInfo)
  return {
    permissionType: isPermissionType(permissionType) ? permissionType : 'write',
    description: typeof block.content === 'string' ? block.content : '',
    ...(typeof block.extra?.toolName === 'string' && block.extra.toolName.trim()
      ? { toolName: block.extra.toolName.trim() }
      : block.tool_call?.name
        ? { toolName: block.tool_call.name }
        : {}),
    ...(typeof block.extra?.serverName === 'string' && block.extra.serverName.trim()
      ? { serverName: block.extra.serverName.trim() }
      : block.tool_call?.server_name
        ? { serverName: block.tool_call.server_name }
        : {}),
    ...(typeof block.extra?.providerId === 'string' && block.extra.providerId.trim()
      ? { providerId: block.extra.providerId.trim() }
      : {}),
    ...(typeof block.extra?.permissionRequestId === 'string' &&
    block.extra.permissionRequestId.trim()
      ? { requestId: block.extra.permissionRequestId.trim() }
      : {}),
    ...(block.extra?.rememberable === false ? { rememberable: false } : { rememberable: true }),
    ...(commandInfo ? { commandInfo } : {})
  }
}

export const collectPendingInteraction = (
  messageId: string,
  messageOrderSeq: number,
  blocks: AssistantMessageBlock[]
): RemotePendingInteractionWithOrder | null => {
  for (const block of blocks) {
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

    const base = {
      messageId,
      messageOrderSeq,
      toolCallId,
      toolName: block.tool_call?.name || '',
      toolArgs: block.tool_call?.params || '',
      ...(block.tool_call?.server_name ? { serverName: block.tool_call.server_name } : {}),
      ...(block.tool_call?.server_icons ? { serverIcons: block.tool_call.server_icons } : {}),
      ...(block.tool_call?.server_description
        ? { serverDescription: block.tool_call.server_description }
        : {})
    }

    if (block.action_type === 'question_request') {
      return {
        ...base,
        type: 'question',
        question: {
          header: typeof block.extra?.questionHeader === 'string' ? block.extra.questionHeader : '',
          question:
            typeof block.extra?.questionText === 'string'
              ? block.extra.questionText
              : block.content || '',
          options: parseQuestionOptions(block.extra?.questionOptions),
          custom: block.extra?.questionCustom !== false,
          multiple: Boolean(block.extra?.questionMultiple)
        }
      }
    }

    return {
      ...base,
      type: 'permission',
      permission: parsePermissionPayload(block)
    }
  }

  return null
}
