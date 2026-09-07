import type {
  AssistantMessageBlock,
  MessageFile,
  UserMessageContent
} from '@shared/types/agent-interface'
import {
  normalizeAttachmentRepresentationPreference,
  normalizeAttachmentResolvedRepresentation,
  normalizePdfEmbeddedTextCoverage
} from '@shared/utils/attachmentRepresentation'
import type { DeepChatAssistantBlockRow } from './tables/deepchatAssistantBlocks'
import type { DeepChatUserMessageFileRow } from './tables/deepchatUserMessageFiles'

/**
 * The transcript stores a message twice: as the raw content string on `deepchat_messages` and
 * as structured rows (user text/files/links, assistant blocks). `getMessage` rebuilds `content`
 * from the structured rows, so what every reader sees is the raw content after one trip through
 * the persist mapping and the read mapping. This module owns both mappings and
 * `canonicalizeMessageContent`, which performs that trip in memory. Anything persisted by one
 * mapping must be read back by the other; the round-trip guard test fails otherwise.
 */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeActiveSkills(activeSkills?: string[]): string[] {
  if (!Array.isArray(activeSkills)) {
    return []
  }

  return Array.from(
    new Set(
      activeSkills
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function parseUserContent(rawContent: string): UserMessageContent | null {
  try {
    const parsed = JSON.parse(rawContent) as Partial<UserMessageContent>
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      files: Array.isArray(parsed.files) ? (parsed.files.filter(Boolean) as MessageFile[]) : [],
      links: Array.isArray(parsed.links)
        ? parsed.links.filter((item): item is string => typeof item === 'string')
        : [],
      search: parsed.search === true,
      think: parsed.think === true,
      activeSkills: normalizeActiveSkills(parsed.activeSkills),
      inlineItems: Array.isArray(parsed.inlineItems) ? parsed.inlineItems : []
    }
  } catch {
    return null
  }
}

export function parseAssistantBlocks(rawContent: string): AssistantMessageBlock[] {
  try {
    const parsed = JSON.parse(rawContent) as AssistantMessageBlock[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// User files: the values `deepchat_user_message_files.replaceForMessage` receives and the columns
// it reads back.

interface UserMessageFileRowInput {
  name?: string
  path: string
  mimeType?: string
  size?: number
  metadataJson?: string | null
}

type StoredUserMessageFile = Pick<
  DeepChatUserMessageFileRow,
  'name' | 'path' | 'mime_type' | 'size' | 'metadata_json'
>

export function toUserMessageFileRowInput(file: MessageFile): UserMessageFileRowInput {
  return {
    name: file.name,
    path: file.path,
    mimeType: file.mimeType ?? file.type,
    size: file.size,
    metadataJson: JSON.stringify({
      type: file.type,
      content: file.content,
      token: file.token,
      thumbnail: file.thumbnail,
      metadata: file.metadata,
      requestedRepresentation: normalizeAttachmentRepresentationPreference(
        file.requestedRepresentation
      ),
      pdfTextCoverage: normalizePdfEmbeddedTextCoverage(file.pdfTextCoverage),
      resolvedRepresentation: normalizeAttachmentResolvedRepresentation(file.resolvedRepresentation)
    })
  }
}

export function toMessageFile(row: StoredUserMessageFile): MessageFile {
  const extra = parseJson<Record<string, unknown>>(row.metadata_json, {})
  return {
    name: row.name ?? '',
    path: row.path,
    type: typeof extra.type === 'string' ? extra.type : (row.mime_type ?? undefined),
    size: row.size ?? undefined,
    content: typeof extra.content === 'string' ? extra.content : undefined,
    mimeType: row.mime_type ?? undefined,
    token: typeof extra.token === 'number' ? extra.token : undefined,
    thumbnail: typeof extra.thumbnail === 'string' ? extra.thumbnail : undefined,
    requestedRepresentation: normalizeAttachmentRepresentationPreference(
      extra.requestedRepresentation
    ),
    pdfTextCoverage: normalizePdfEmbeddedTextCoverage(extra.pdfTextCoverage),
    resolvedRepresentation: normalizeAttachmentResolvedRepresentation(extra.resolvedRepresentation),
    metadata:
      extra.metadata && typeof extra.metadata === 'object' && !Array.isArray(extra.metadata)
        ? (extra.metadata as MessageFile['metadata'])
        : undefined
  }
}

/** The stored shape of a file input: SQLite keeps a missing value as NULL. */
function toStoredUserMessageFile(input: UserMessageFileRowInput): StoredUserMessageFile {
  return {
    name: input.name ?? null,
    path: input.path,
    mime_type: input.mimeType ?? null,
    size: input.size ?? null,
    metadata_json: input.metadataJson ?? null
  }
}

interface AssembledUserContentInput {
  text: string
  files: MessageFile[]
  links: string[]
  search: boolean
  think: boolean
  activeSkills: string[]
  inlineItems: NonNullable<UserMessageContent['inlineItems']>
}

export function assembleUserContent(input: AssembledUserContentInput): string {
  return JSON.stringify({
    text: input.text,
    files: input.files,
    links: input.links,
    search: input.search,
    think: input.think,
    ...(input.activeSkills.length > 0 ? { activeSkills: input.activeSkills } : {}),
    ...(input.inlineItems.length > 0 ? { inlineItems: input.inlineItems } : {})
  } satisfies UserMessageContent)
}

// Assistant blocks: the column values `deepchat_assistant_blocks.replaceForMessage` writes and the
// block it reads back.

export type PersistedBlockExtra = {
  id?: string
  timestamp?: number
  imageData?: string
  extra?: AssistantMessageBlock['extra']
  toolCallExtra?: Omit<
    NonNullable<AssistantMessageBlock['tool_call']>,
    'id' | 'name' | 'params' | 'response'
  >
  reasoningTime?: number
}

type AssistantBlockRowInput = Omit<DeepChatAssistantBlockRow, 'message_id' | 'block_index'>

function buildPersistedExtra(block: AssistantMessageBlock): PersistedBlockExtra {
  return {
    id: block.id,
    timestamp: block.timestamp,
    imageData: block.image_data?.data,
    extra: block.extra,
    toolCallExtra: block.tool_call
      ? {
          rtkApplied: block.tool_call.rtkApplied,
          rtkMode: block.tool_call.rtkMode,
          rtkFallbackReason: block.tool_call.rtkFallbackReason,
          imagePreviews: block.tool_call.imagePreviews,
          server_name: block.tool_call.server_name,
          server_icons: block.tool_call.server_icons,
          server_description: block.tool_call.server_description,
          mcpResult: block.tool_call.mcpResult
        }
      : undefined,
    reasoningTime: typeof block.reasoning_time === 'number' ? block.reasoning_time : undefined
  }
}

export function toAssistantBlockRowInput(
  block: AssistantMessageBlock,
  updatedAt: number
): AssistantBlockRowInput {
  const reasoningRange =
    block.reasoning_time &&
    typeof block.reasoning_time === 'object' &&
    typeof block.reasoning_time.start === 'number' &&
    typeof block.reasoning_time.end === 'number'
      ? block.reasoning_time
      : null

  return {
    block_type: block.type,
    status: block.status,
    text_content: block.content ?? null,
    tool_call_id: block.tool_call?.id ?? null,
    tool_name: block.tool_call?.name ?? null,
    tool_params: block.tool_call?.params ?? null,
    tool_response: block.tool_call?.response ?? null,
    action_type: block.action_type ?? null,
    image_mime_type: block.image_data?.mimeType ?? null,
    reasoning_start_at: reasoningRange?.start ?? null,
    reasoning_end_at: reasoningRange?.end ?? null,
    extra_json: JSON.stringify(buildPersistedExtra(block)),
    updated_at: updatedAt
  }
}

function normalizePersistedActionType(
  actionType: string | null
): AssistantMessageBlock['action_type'] | undefined {
  if (
    actionType === 'tool_call_permission' ||
    actionType === 'question_request' ||
    actionType === 'rate_limit'
  ) {
    return actionType
  }

  return undefined
}

export function toAssistantBlock(row: AssistantBlockRowInput): AssistantMessageBlock {
  const extra = parseJson<PersistedBlockExtra>(row.extra_json, {})

  const toolCall =
    row.tool_call_id || row.tool_name || row.tool_params || row.tool_response || extra.toolCallExtra
      ? {
          ...extra.toolCallExtra,
          id: row.tool_call_id ?? undefined,
          name: row.tool_name ?? undefined,
          params: row.tool_params ?? undefined,
          response: row.tool_response ?? undefined
        }
      : undefined

  const reasoningTime =
    typeof extra.reasoningTime === 'number'
      ? extra.reasoningTime
      : row.reasoning_start_at !== null && row.reasoning_end_at !== null
        ? {
            start: row.reasoning_start_at,
            end: row.reasoning_end_at
          }
        : undefined

  const imageData = extra.imageData?.trim()
  const actionType = normalizePersistedActionType(row.action_type)

  return {
    id: extra.id,
    type: row.block_type as AssistantMessageBlock['type'],
    content: row.text_content ?? undefined,
    status: row.status as AssistantMessageBlock['status'],
    timestamp: extra.timestamp ?? row.updated_at,
    reasoning_time: reasoningTime,
    image_data:
      imageData && row.image_mime_type
        ? {
            data: imageData,
            mimeType: row.image_mime_type
          }
        : undefined,
    tool_call: toolCall as AssistantMessageBlock['tool_call'],
    extra: extra.extra,
    ...(actionType ? { action_type: actionType } : {})
  }
}

/**
 * The content string `getMessage` would return after `rawContent` has been persisted and read
 * back, computed without touching the tables. Content the tables would not structure (unparseable
 * user JSON, an empty or invalid block array) is returned as is, which is also what the read path
 * does when it finds no structured rows.
 */
export function canonicalizeMessageContent(
  role: 'user' | 'assistant',
  rawContent: string,
  updatedAt: number
): string {
  if (role === 'user') {
    const parsed = parseUserContent(rawContent)
    if (!parsed) {
      return rawContent
    }
    return assembleUserContent({
      text: parsed.text,
      files: parsed.files.map((file) =>
        toMessageFile(toStoredUserMessageFile(toUserMessageFileRowInput(file)))
      ),
      links: parsed.links,
      search: parsed.search === true,
      think: parsed.think === true,
      activeSkills: parsed.activeSkills ?? [],
      inlineItems: parsed.inlineItems ?? []
    })
  }

  const blocks = parseAssistantBlocks(rawContent)
  if (blocks.length === 0) {
    return rawContent
  }
  return JSON.stringify(
    blocks.map((block) => toAssistantBlock(toAssistantBlockRowInput(block, updatedAt)))
  )
}
