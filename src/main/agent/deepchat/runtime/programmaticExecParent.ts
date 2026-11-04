import type { PermissionMode } from '@shared/types/agent-interface'
import type {
  ExecutionJournalCommitReceipt,
  ExecutionOperationIdentity
} from '@/tape/domain/executionJournal'
import type { ProgrammaticToolCapabilityV1 } from './programmaticToolSurface'
import type { ToolSurfaceDeferredDispatch, ToolSurfaceSnapshot } from './toolSurface'

type ProgrammaticOperation = ExecutionOperationIdentity & { sessionId: string; messageId: string }
type ProgrammaticResult = Readonly<{ responseText: string; isError: boolean }>

export interface ProgrammaticToolParentRegistration {
  readonly operation: ProgrammaticOperation
  armOuterDispatch(
    receipt: ExecutionJournalCommitReceipt & { operation: ProgrammaticOperation }
  ): void
  takeCompletedInvocationResult(): ProgrammaticResult
  cancelBeforeOuterDispatch(): void
  settleProcessFailure(input: { responseText: string }): Readonly<{
    result: ProgrammaticResult
    receipt: ExecutionJournalCommitReceipt
  }>
  settleOuterOutcome(input: ProgrammaticResult): ExecutionJournalCommitReceipt
}

export interface ProgrammaticExecRequest {
  toolName: string
  argumentsJson: string
  operation: ExecutionOperationIdentity
  sessionId: string
  messageId: string
  permissionMode: PermissionMode
  toolSurfaceSnapshot?: ToolSurfaceSnapshot
  capability?: ProgrammaticToolCapabilityV1
  deferredDispatch?: ToolSurfaceDeferredDispatch
}

export interface ProgrammaticToolPort {
  prepare(input: ProgrammaticExecRequest): ProgrammaticToolParentRegistration | undefined
  commitRunTerminal(
    run: { sessionId: string; runId: string },
    commit: () => ExecutionJournalCommitReceipt
  ): ExecutionJournalCommitReceipt
  releaseSession(sessionId: string): void
  revokeConversation(sessionId: string): void
}

export function isProgrammaticExecAttempt(toolName: string, argumentsJson: string): boolean {
  if (toolName !== 'exec') return false
  try {
    const parsed = JSON.parse(argumentsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const args = parsed as Record<string, unknown>
    const command = typeof args.command === 'string' ? args.command : ''
    return (
      typeof args.stdin === 'string' ||
      /^deepchat tool (?:search|describe|call|batch)(?:\s|$)/.test(command)
    )
  } catch {
    return false
  }
}

export function prepareProgrammaticExecParent(
  input: ProgrammaticExecRequest & {
    parents?: Pick<ProgrammaticToolPort, 'prepare'>
  }
): ProgrammaticToolParentRegistration | undefined {
  if (!isProgrammaticExecAttempt(input.toolName, input.argumentsJson)) return undefined
  const { parents, ...request } = input
  if (!parents) throw new Error('Programmatic Tool exec requires its exact active View capability')
  return parents.prepare(request)
}
