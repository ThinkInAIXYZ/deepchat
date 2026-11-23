import type { JsonValue } from '@shared/contracts/json'
import type { SessionDatabase } from '@/session/data/database'
import type {
  MemoryAuditInput,
  MemoryAuditReceipt,
  MemorySourceRange
} from '@/memory/runtimeContracts'
import { isRetiredWorkflowResultMessageMetadata } from '@shared/orchestration/retiredWorkflowData'
import { parseAssistantBlocks } from '@/session/data/messageContent'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import type { DimContent } from './content'

interface MemorySourceOptions {
  database: SessionDatabase
  content: Pick<DimContent, 'latest' | 'transcript'>
  host: DimRuntimeSupervisor
}

/** Memory consumes settled native views. It cannot read the private SQLite file or resume a turn. */
export class DimMemorySource {
  constructor(private readonly options: MemorySourceOptions) {}

  readonly readRange = async (
    sessionId: string,
    from: number,
    to: number
  ): Promise<MemorySourceRange> => {
    const binding = this.require(sessionId)
    const ref = { sessionId: binding.dimSessionId, branchId: binding.branchId }
    const cutoff = await this.options.content.latest(ref, ['turn/end', 'deepchat/history-sealed'])
    if (!cutoff.event) return { rows: [], cursorCommitAllowed: true }
    const through = String(cutoff.event.sequence)
    const snapshot = await this.options.content.transcript(ref, sessionId, through)
    const current = this.require(sessionId)
    if (
      current.dimSessionId !== binding.dimSessionId ||
      current.branchId !== binding.branchId ||
      current.generation !== binding.generation
    )
      throw new Error('Memory source was replaced during its read')
    const lastAssistant =
      snapshot.messages
        .filter((message) => message.role === 'assistant' && message.status !== 'pending')
        .at(-1)?.orderSeq ?? 0
    return {
      cursorCommitAllowed: true,
      rows: snapshot.messages
        .filter(
          (message) =>
            message.orderSeq > from &&
            message.orderSeq <= Math.min(to, lastAssistant) &&
            message.status !== 'pending' &&
            !isRetiredWorkflowResultMessageMetadata(message.metadata)
        )
        .map((message) => ({
          sessionId,
          messageId: message.id,
          orderSeq: message.orderSeq,
          entryId: { kind: 'dim' as const, ...ref, through, messageId: message.id },
          role: message.role,
          content: message.content,
          status: message.status as 'sent' | 'error',
          hadToolUse:
            message.role === 'assistant' &&
            parseAssistantBlocks(message.content).some((block) => block.type === 'tool_call')
        }))
    }
  }

  readonly audit = async (input: MemoryAuditInput): Promise<MemoryAuditReceipt> => {
    const binding = this.require(input.sessionId)
    const client = await this.options.host.start()
    return client.call('session.deepchat_memory.audit', {
      sessionId: binding.dimSessionId,
      branchId: binding.branchId,
      name: input.name,
      state: input.state as JsonValue,
      ...(input.meta ? { meta: input.meta } : {})
    })
  }

  private require(sessionId: string) {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding || this.options.database.dimScopeChangesTable.get(sessionId))
      throw new Error('Memory source has no current native scope')
    return binding
  }
}
