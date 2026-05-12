import type { AssistantMessageBlock } from '@shared/chat'
import type { AcpConfigState } from '@shared/presenter'

export type DeepChatAgentEvent =
  | { type: 'message.delta'; conversationId: string; text: string }
  | { type: 'content.block'; conversationId: string; block: AssistantMessageBlock }
  | { type: 'plan.updated'; conversationId: string; entries: unknown[] }
  | { type: 'terminal.updated'; conversationId: string; terminal: unknown }
  | { type: 'permission.requested'; conversationId: string; request: unknown }
  | { type: 'config.updated'; conversationId: string; configState: AcpConfigState }
  | { type: 'turn.completed'; conversationId: string; stopReason: string }
