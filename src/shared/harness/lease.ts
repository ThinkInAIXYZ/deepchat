import {
  AgentInvocationAdmissionAbortedError,
  type AgentInvocationAdmissionPort,
  type AgentInvocationAdmissionOptions,
  type AgentInvocationLease,
  type AgentInvocationLeaseState,
  type InternalAgentInvocationPermit
} from '@shared/harness/admission'

export class StatefulAgentInvocationLease implements AgentInvocationLease {
  private currentState: AgentInvocationLeaseState = 'suspended'
  private permit: InternalAgentInvocationPermit | null = null
  private acquisition:
    | {
        controller: AbortController
        promise: Promise<void>
        cleanupSignals: () => void
      }
    | undefined

  constructor(
    private readonly admission: Pick<AgentInvocationAdmissionPort, 'acquire'>,
    private readonly options: AgentInvocationAdmissionOptions
  ) {}

  get state(): AgentInvocationLeaseState {
    return this.currentState
  }

  resume(options?: { signal?: AbortSignal }): Promise<void> {
    if (this.currentState === 'released') {
      return Promise.reject(new AgentInvocationAdmissionAbortedError())
    }
    if (this.currentState === 'active') return Promise.resolve()
    if (this.acquisition) {
      if (this.currentState === 'acquiring') return this.acquisition.promise
      return this.acquisition.promise
        .catch(() => undefined)
        .then(async () => await this.resume(options))
    }

    const controller = new AbortController()
    const cleanupSignals = forwardAbortSignals([this.options.signal, options?.signal], controller)
    this.currentState = 'acquiring'
    const promise = this.admission
      .acquire({ ...this.options, signal: controller.signal })
      .then((permit) => {
        const internalPermit = permit as InternalAgentInvocationPermit
        if (
          controller.signal.aborted ||
          this.currentState !== 'acquiring' ||
          this.acquisition?.controller !== controller
        ) {
          internalPermit.releaseWithReason(
            this.currentState === 'released' ? 'lease_released' : 'lease_suspended'
          )
          throw new AgentInvocationAdmissionAbortedError()
        }
        this.permit = internalPermit
        this.currentState = 'active'
      })
      .finally(() => {
        if (this.acquisition?.controller !== controller) return
        this.acquisition.cleanupSignals()
        this.acquisition = undefined
        if (this.currentState === 'acquiring') this.currentState = 'suspended'
      })
    this.acquisition = { controller, promise, cleanupSignals }
    return promise
  }

  suspend(): void {
    if (this.currentState === 'released' || this.currentState === 'suspended') return
    if (this.currentState === 'active') {
      this.releaseActivePermit('lease_suspended', 'suspended')
      return
    }
    this.currentState = 'suspended'
    this.acquisition?.controller.abort('Agent invocation lease suspended.')
  }

  release(): void {
    if (this.currentState === 'released') return
    if (this.currentState === 'active') {
      this.releaseActivePermit('lease_released', 'released')
      return
    }
    this.currentState = 'released'
    this.acquisition?.controller.abort('Agent invocation lease released.')
  }

  private releaseActivePermit(
    reason: 'lease_suspended' | 'lease_released',
    nextState: 'suspended' | 'released'
  ): void {
    if (!this.permit) throw new Error('Active Agent invocation lease has no permit.')
    this.permit.releaseWithReason(reason)
    this.permit = null
    this.currentState = nextState
  }
}

function forwardAbortSignals(
  signals: Array<AbortSignal | undefined>,
  target: AbortController
): () => void {
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = []
  for (const signal of signals) {
    if (!signal) continue
    const listener = () => target.abort(signal.reason)
    if (signal.aborted) {
      listener()
      break
    }
    signal.addEventListener('abort', listener, { once: true })
    listeners.push({ signal, listener })
  }
  return () => {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener('abort', listener)
    }
  }
}
