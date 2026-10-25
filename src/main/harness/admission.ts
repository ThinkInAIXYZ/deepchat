import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AdmissionSnapshotSchema,
  DEFAULT_AGENT_INVOCATION_CAPACITY,
  DEFAULT_AGENT_INVOCATION_MAX_PENDING,
  AgentInvocationAdmissionAbortedError,
  AgentInvocationAdmissionClosedError,
  AgentInvocationAdmissionQueueFullError,
  normalizeAdmissionOwnerId,
  normalizeAdmissionOwnerLimit,
  snapshotAdmissionCorrelation,
  type AgentInvocationAdmissionDiagnosticsOptions,
  type AgentInvocationAdmissionOptions,
  type AgentInvocationAdmissionPort,
  type AgentInvocationPermit,
  type InternalAgentInvocationPermit
} from '@shared/harness/admission'
import { StatefulAgentInvocationLease } from '@shared/harness/lease'
import { HarnessRuntime } from './runtime'

export class RutisAgentInvocationAdmission implements AgentInvocationAdmissionPort {
  private closed: AgentInvocationAdmissionClosedError | undefined
  private closePromise: Promise<void> | undefined
  private readonly releases = new Set<Promise<unknown>>()

  private constructor(
    private readonly runtime: HarnessRuntime,
    private readonly capacity: number,
    private readonly maxPending: number,
    private readonly diagnostics: AgentInvocationAdmissionDiagnosticsOptions
  ) {}

  static create(options: {
    runtime: HarnessRuntime
    capacity?: number
    maxPending?: number
    diagnostics?: AgentInvocationAdmissionDiagnosticsOptions
  }): RutisAgentInvocationAdmission {
    const capacity = options.capacity ?? DEFAULT_AGENT_INVOCATION_CAPACITY
    const maxPending = options.maxPending ?? DEFAULT_AGENT_INVOCATION_MAX_PENDING
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(maxPending) ||
      maxPending < 0
    ) {
      throw new Error('Invalid admission limits')
    }
    const diagnostics = options.diagnostics ?? {}
    return new RutisAgentInvocationAdmission(options.runtime, capacity, maxPending, diagnostics)
  }

  get identity() {
    return this.runtime.identity
  }

  async acquire(options: AgentInvocationAdmissionOptions): Promise<AgentInvocationPermit> {
    if (this.closed) throw this.closed
    const ownerId = normalizeAdmissionOwnerId(options.ownerId)
    const maxActiveForOwner = normalizeAdmissionOwnerLimit(options.maxActiveForOwner, this.capacity)
    const id = randomUUID()
    let released = false
    const releaseRemote = (reason: 'permit_released' | 'lease_suspended' | 'lease_released') => {
      if (released) return
      released = true
      const release = this.runtime
        .request('release', [id, reason, this.observationsEnabled()])
        .catch(() => undefined)
        .finally(() => this.releases.delete(release))
      this.releases.add(release)
    }
    const request = this.runtime.request('acquire', [
      id,
      {
        ownerId,
        maxActiveForOwner,
        aborted: options.signal?.aborted === true,
        correlation: snapshotAdmissionCorrelation(options.correlation)
      },
      this.observationsEnabled()
    ])
    const cancel = () => releaseRemote('permit_released')
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    try {
      z.literal(id).parse(await request)
    } catch (error) {
      // Cancellation can discard a successful remote reply; identity is known before acquire.
      releaseRemote('permit_released')
      throw options.signal?.aborted
        ? new AgentInvocationAdmissionAbortedError()
        : this.admissionError(error)
    } finally {
      options.signal?.removeEventListener('abort', cancel)
    }
    const permit: InternalAgentInvocationPermit = {
      release: () => permit.releaseWithReason('permit_released'),
      releaseWithReason: (reason) => {
        releaseRemote(reason)
      }
    }
    if (options.signal?.aborted || this.closed) {
      permit.release()
      throw this.closed ?? new AgentInvocationAdmissionAbortedError()
    }
    return permit
  }

  createLease(options: AgentInvocationAdmissionOptions) {
    return new StatefulAgentInvocationLease(this, options)
  }

  async run<T>(options: AgentInvocationAdmissionOptions, task: () => Promise<T>): Promise<T> {
    const permit = await this.acquire(options)
    try {
      if (options.signal?.aborted) throw new AgentInvocationAdmissionAbortedError()
      return await task()
    } finally {
      permit.release()
    }
  }

  close(reason = 'Agent invocation admission is closed.'): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = new AgentInvocationAdmissionClosedError(reason)
    this.closePromise = (async () => {
      await Promise.all(this.releases)
      await this.runtime.request('close', [reason, this.observationsEnabled()])
    })()
    return this.closePromise
  }

  async flushObservations(): Promise<void> {
    await Promise.all(this.releases)
    await this.runtime.request('flushObservations', [])
  }

  async snapshot() {
    await Promise.all(this.releases)
    const value = z
      .object({ admission: AdmissionSnapshotSchema, runtime: z.unknown() })
      .strict()
      .parse(await this.runtime.request('snapshot', []))
    return value.admission
  }

  private observationsEnabled(): boolean {
    try {
      return (
        this.diagnostics.observe !== undefined && (this.diagnostics.observationsEnabled?.() ?? true)
      )
    } catch {
      return false
    }
  }

  private admissionError(value: unknown): Error {
    if (!(value instanceof Error)) return new Error('Admission request failed')
    switch (value.name) {
      case 'AgentInvocationAdmissionAbortedError':
        return new AgentInvocationAdmissionAbortedError()
      case 'AgentInvocationAdmissionClosedError':
        return new AgentInvocationAdmissionClosedError(value.message)
      case 'AgentInvocationAdmissionQueueFullError':
        return new AgentInvocationAdmissionQueueFullError(this.maxPending)
      default:
        return value
    }
  }
}
