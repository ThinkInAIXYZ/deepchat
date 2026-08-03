import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import { projectFinalAnswerFromDeliverySegments } from '@shared/lib/assistantDeliverySegments'
import type { WorkflowInvocation } from '@shared/workflow/domain'
import { WorkflowUsageSchema, type WorkflowUsage } from '@shared/workflow/serviceContracts'

export interface WorkflowChildRuntimeRepositoryPort {
  setInvocationInteractionState(
    invocationId: string,
    waiting: boolean,
    now?: number
  ): WorkflowInvocation | null
}

export type ChildTerminalState =
  | {
      status: 'completed'
      responseMarkdown: string
      answerMarkdown: string
      usage: WorkflowUsage
    }
  | {
      status: 'error'
      responseMarkdown: string
      answerMarkdown: string
      usage: WorkflowUsage
    }

export class ChildRuntimeTracker {
  private started = false
  private failed = false
  private terminalState: ChildTerminalState | null = null
  private runtimeStatus: 'idle' | 'generating' | 'error' | null = null
  private responseMarkdown = ''
  private answerMarkdown = ''
  private usage: WorkflowUsage = {}
  private interactionWaiting: boolean
  private stoppedState = false
  private resolveTerminal!: (state: ChildTerminalState) => void
  private rejectTerminal!: (error: unknown) => void
  private resolveStopped!: () => void
  private readonly unsubscribe: () => void
  readonly terminal: Promise<ChildTerminalState>
  readonly stopped: Promise<void>

  constructor(
    private readonly sessionId: string,
    private readonly invocationId: string,
    private readonly repository: WorkflowChildRuntimeRepositoryPort,
    subscribe: (listener: (update: SessionRuntimeUpdate) => void) => () => void,
    private readonly now: () => number,
    initialInteractionWaiting: boolean,
    private readonly onInvocationChanged?: (invocation: WorkflowInvocation) => void
  ) {
    this.interactionWaiting = initialInteractionWaiting
    this.terminal = new Promise<ChildTerminalState>((resolve, reject) => {
      this.resolveTerminal = resolve
      this.rejectTerminal = reject
    })
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve
    })
    void this.terminal.catch(() => undefined)
    this.unsubscribe = subscribe((update) => this.onUpdate(update))
  }

  get isStopped(): boolean {
    return this.stoppedState
  }

  get isWaitingInteraction(): boolean {
    return this.interactionWaiting
  }

  markStarted(): void {
    this.started = true
    this.maybeSettleStopped()
    this.maybeSettleTerminal()
  }

  close(): void {
    this.unsubscribe()
  }

  private onUpdate(update: SessionRuntimeUpdate): void {
    if (update.sessionId !== this.sessionId) {
      return
    }
    if (update.kind === 'status' && update.status) {
      this.runtimeStatus = update.status
      if (update.status === 'generating') {
        this.started = true
      }
      this.maybeSettleStopped()
    }
    if (this.terminalState || this.failed) {
      return
    }
    try {
      if (update.kind === 'blocks') {
        this.responseMarkdown = update.responseMarkdown?.trim() || this.responseMarkdown
        if (update.deliverySegments) {
          this.answerMarkdown = projectFinalAnswerFromDeliverySegments(update.deliverySegments)
        }
        this.applyWaitingState(
          update.waitingInteraction !== null && update.waitingInteraction !== undefined
        )
        return
      }
      if (update.kind !== 'status' || !update.status) {
        return
      }
      if (update.usage) {
        this.usage = normalizeUsage(update.usage)
      }
      if (update.status === 'generating') {
        return
      }
      this.maybeSettleTerminal()
    } catch (error) {
      this.failed = true
      this.rejectTerminal(error)
    }
  }

  private maybeSettleStopped(): void {
    if (
      !this.started ||
      this.stoppedState ||
      (this.runtimeStatus !== 'idle' && this.runtimeStatus !== 'error')
    ) {
      return
    }
    this.stoppedState = true
    this.resolveStopped()
  }

  private maybeSettleTerminal(): void {
    if (
      !this.started ||
      this.failed ||
      this.terminalState ||
      (this.runtimeStatus !== 'idle' && this.runtimeStatus !== 'error')
    ) {
      return
    }
    const terminalState: ChildTerminalState = {
      status: this.runtimeStatus === 'error' ? 'error' : 'completed',
      responseMarkdown: this.responseMarkdown,
      answerMarkdown: this.answerMarkdown,
      usage: this.usage
    }
    this.terminalState = terminalState
    this.resolveTerminal(terminalState)
  }

  private applyWaitingState(waiting: boolean): void {
    if (waiting === this.interactionWaiting) {
      return
    }
    const invocation = this.repository.setInvocationInteractionState(
      this.invocationId,
      waiting,
      this.now()
    )
    this.interactionWaiting = waiting
    if (invocation) {
      this.onInvocationChanged?.(invocation)
    }
  }
}

function normalizeUsage(usage: Record<string, number>): WorkflowUsage {
  const parsed = WorkflowUsageSchema.safeParse(usage)
  if (!parsed.success) {
    throw new Error('Workflow child emitted invalid usage accounting.')
  }
  return parsed.data
}
