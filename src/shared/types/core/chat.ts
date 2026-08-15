// Core chat types (strong-typed UI blocks)

import type { ToolCallImagePreview } from './mcp'
import type { AgentPlanDisplayItem, AgentPlanTerminalReason } from '../agent-plan'
import type { QuestionOption } from './question'
import type {
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation,
  PdfEmbeddedTextCoverage
} from '../attachment'

export type {
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation
} from '../attachment'

export type Message = {
  id: string
  content: UserMessageContent | AssistantMessageBlock[]
  role: MESSAGE_ROLE
  timestamp: number
  avatar: string
  name: string
}

export type MESSAGE_ROLE = 'user' | 'assistant' | 'system' | 'agent'

export type UserMessageTextBlock = { type: 'text'; content: string }
export type UserMessageCodeBlock = { type: 'code'; content: string; language: string }
export type UserMessageMentionBlock = {
  type: 'mention'
  content: string
  id: string
  category: string
}
export type UserMessageInlineItem =
  | {
      type: 'skill'
      offset: number
      skillName: string
    }
  | {
      type: 'file'
      offset: number
      fileName: string
      filePath: string
      mimeType?: string
    }

export type UserMessageContent = {
  continue?: boolean
  files: MessageFile[]
  resources?: Array<{ uri: string; name?: string; client: { name: string; icon: string } }>
  prompts?: Array<{
    name: string
    description?: string
    arguments?: { name: string; description?: string; required: boolean }[]
  }>
  links: string[]
  think: boolean
  search: boolean
  activeSkills?: string[]
  text: string
  inlineItems?: UserMessageInlineItem[]
  content?: (UserMessageTextBlock | UserMessageMentionBlock | UserMessageCodeBlock)[]
}

export type MessageFile = {
  name: string
  content: string
  mimeType: string
  token?: number
  path?: string
  thumbnail?: string
  requestedRepresentation?: AttachmentRepresentationPreference
  resolvedRepresentation?: AttachmentResolvedRepresentation
  pdfTextCoverage?: PdfEmbeddedTextCoverage
}

export type AssistantMessageBlock = {
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'plan'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'image'
    | 'audio'
    | 'artifact-thinking'
  content?: string
  extra?: AssistantMessageExtra
  status:
    | 'success'
    | 'loading'
    | 'cancel'
    | 'error'
    | 'reading'
    | 'optimizing'
    | 'pending'
    | 'granted'
    | 'denied'
  timestamp: number
  artifact?: {
    identifier: string
    title: string
    type:
      | 'application/vnd.ant.code'
      | 'text/markdown'
      | 'text/html'
      | 'image/svg+xml'
      | 'application/vnd.ant.mermaid'
      | 'application/vnd.ant.react'
    language?: string
  }
  tool_call?: {
    id?: string
    name?: string
    params?: string
    response?: string
    rtkApplied?: boolean
    rtkMode?: 'rewrite' | 'direct' | 'bypass'
    rtkFallbackReason?: string
    imagePreviews?: ToolCallImagePreview[]
    server_name?: string
    server_icons?: string
    server_description?: string
  }
  action_type?:
    | 'tool_call_permission'
    | 'maximum_tool_calls_reached'
    | 'rate_limit'
    | 'question_request'
  image_data?: { data: string; mimeType: string }
  reasoning_time?: { start: number; end: number }
}

export type AssistantMessageExtra = Record<string, string | number | object[] | boolean> & {
  needsUserAction?: boolean
  permissionType?: 'read' | 'write' | 'all' | 'command'
  grantedPermissions?: 'read' | 'write' | 'all' | 'command'
  toolName?: string
  toolSource?: 'agent' | 'mcp'
  serverName?: string
  providerId?: string
  providerLogicalRound?: number
  providerRequestSeq?: number
  providerPhysicalAttempt?: number
  permissionRequestId?: string
  permissionRequest?: string
  executionContractBinding?: string
  toolSurfaceBinding?: string
  commandInfo?: string
  rememberable?: boolean
  questionHeader?: string
  questionText?: string
  questionOptions?: QuestionOption[] | string
  questionMultiple?: boolean
  questionCustom?: boolean
  questionResolution?: 'asked' | 'replied' | 'rejected'
  questionFollowUpPending?: boolean
  answerText?: string
  answerMessageId?: string
  skillDraftAction?: string
  skillDraftId?: string
  skillDraftName?: string
  skillDraftPreview?: string
  skillDraftStatus?: string
  skillDraftError?: string
  internalTool?: boolean
  plan_entries?: AgentPlanDisplayItem[]
  plan_explanation?: string
  plan_revision?: number
  plan_updated_at?: string
  plan_terminal_reason?: AgentPlanTerminalReason
  toolCallSkippedReason?: 'max_tool_calls' | 'max_tokens'
  toolCallIncompleteReason?: 'max_tokens'
}

export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageProviderOptions,
  ChatMessageRole,
  ChatMessageToolCall
} from './chat-message'
