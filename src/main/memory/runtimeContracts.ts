import type { AppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentMemorySource } from '@shared/types/agent-memory'
import type { MemoryIngestionMessage } from './ports'
import type { MemorySessionHandle } from '@/agent/deepchat/memory/memoryPromptContributor'

export interface MemoryRuntimeSession {
  handle: MemorySessionHandle
  providerId: string
  modelId: string
}
export interface MemoryAuditPosition {
  sessionId: string
  branchId: string
  sequence: string
  eventId: string
}
export interface MemoryAuditInput {
  sessionId: string
  name: string
  state: Record<string, unknown>
  meta?: { messageId?: string }
}
export interface MemoryAuditReceipt {
  entryId: number | null
  timeline?: MemoryAuditPosition
}
export interface MemorySourceRange {
  rows: Array<Omit<MemoryIngestionMessage, 'entryId'> & { entryId: AgentMemorySource }>
  cursorCommitAllowed: boolean
}
export interface MemorySessionReader {
  (sessionId: AppSessionId): MemoryRuntimeSession | undefined
}
