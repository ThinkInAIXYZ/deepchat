import type { SessionRuntimeUpdate } from '@/session/runtimeEvents'
import type { WorkflowInvocation } from '@shared/workflow/domain'

export interface WorkflowChildRuntimeRepositoryPort {
  requireInvocation(invocationId: string): WorkflowInvocation
  markInvocationRunning(invocationId: string, now?: number): WorkflowInvocation
  setInvocationWaiting(invocationId: string, now?: number): WorkflowInvocation
}

export type ChildTerminalState =
  | {
      status: 'completed'
      responseMarkdown: string
      answerMarkdown: string
    }
  | {
      status: 'error'
      responseMarkdown: string
      answerMarkdown: string
    }

export class ChildRuntimeTracker {
  private started = false
  private failed = false
  private terminalState: ChildTerminalState | null = null
  private runtimeStatus: 'idle' | 'generating' | 'error' | null = null
  private responseMarkdown = ''
  private answerMarkdown = ''
  private resolveTerminal!: (state: ChildTerminalState) => void
  private rejectTerminal!: (error: unknown) => void
  private readonly unsubscribe: () => void
  readonly terminal: Promise<ChildTerminalState>

  constructor(
    private readonly sessionId: string,
    private readonly invocationId: string,
    private readonly repository: WorkflowChildRuntimeRepositoryPort,
    subscribe: (listener: (update: SessionRuntimeUpdate) => void) => () => void,
    private readonly now: () => number
  ) {
    this.terminal = new Promise<ChildTerminalState>((resolve, reject) => {
      this.resolveTerminal = resolve
      this.rejectTerminal = reject
    })
    void this.terminal.catch(() => undefined)
    this.unsubscribe = subscribe((update) => this.onUpdate(update))
  }

  get isTerminal(): boolean {
    return this.terminalState !== null
  }

  markStarted(): void {
    this.started = true
    this.maybeSettleTerminal()
  }

  close(): void {
    this.unsubscribe()
  }

  private onUpdate(update: SessionRuntimeUpdate): void {
    if (update.sessionId !== this.sessionId || this.terminalState || this.failed) {
      return
    }
    try {
      if (update.kind === 'blocks') {
        this.responseMarkdown = update.responseMarkdown?.trim() || this.responseMarkdown
        const answerMarkdown = update.deliverySegments
          ?.filter((segment) => segment.kind === 'answer')
          .map((segment) => segment.text.trim())
          .filter(Boolean)
          .join('\n\n')
        this.answerMarkdown = answerMarkdown || this.answerMarkdown
        this.applyWaitingState(
          update.waitingInteraction !== null && update.waitingInteraction !== undefined
        )
        return
      }
      if (update.kind !== 'status' || !update.status) {
        return
      }
      this.runtimeStatus = update.status
      if (update.status === 'generating') {
        this.started = true
        return
      }
      this.maybeSettleTerminal()
    } catch (error) {
      this.failed = true
      this.rejectTerminal(error)
    }
  }

  private maybeSettleTerminal(): void {
    if (
      !this.started ||
      this.terminalState ||
      (this.runtimeStatus !== 'idle' && this.runtimeStatus !== 'error')
    ) {
      return
    }
    const terminalState: ChildTerminalState = {
      status: this.runtimeStatus === 'error' ? 'error' : 'completed',
      responseMarkdown: this.responseMarkdown,
      answerMarkdown: this.answerMarkdown
    }
    this.terminalState = terminalState
    this.resolveTerminal(terminalState)
  }

  private applyWaitingState(waiting: boolean): void {
    const invocation = this.repository.requireInvocation(this.invocationId)
    if (waiting && invocation.status === 'running') {
      this.repository.setInvocationWaiting(this.invocationId, this.now())
    } else if (!waiting && invocation.status === 'waiting_interaction') {
      this.repository.markInvocationRunning(this.invocationId, this.now())
    }
  }
}
