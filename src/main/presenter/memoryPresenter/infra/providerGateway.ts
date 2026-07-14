import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'

import type {
  MemoryProviderGatewayDeps,
  MemoryProviderGatewayPort,
  MemoryProviderPurpose
} from '../ports'
import {
  createMemoryProviderCancellationError,
  createMemoryProviderCapacityError,
  createMemoryProviderDeadlineError
} from '../core/providerCancellation'

const DEADLINE_MS: Record<MemoryProviderPurpose, number> = {
  'query-embedding': 800,
  dimension: 15_000,
  'embedding-batch': 30_000,
  'embedding-warm': 30_000,
  extraction: 60_000,
  decision: 60_000,
  maintenance: 60_000
}

const MAX_UNSETTLED_REQUESTS_PER_KEY = 2
const MAX_UNSETTLED_REQUESTS_GLOBAL = 64

export class MemoryProviderGateway implements MemoryProviderGatewayPort {
  private readonly activeControllersByAgent = new Map<string, Set<AbortController>>()
  private readonly generationByAgent = new Map<string, number>()
  private readonly unsettledByKey = new Map<string, number>()
  private unsettledTotal = 0
  private admissionWaiting = 0
  private stopped = false

  constructor(private readonly deps: MemoryProviderGatewayDeps) {}

  abortAll(): void {
    this.stopped = true
    for (const controllers of this.activeControllersByAgent.values()) {
      for (const controller of controllers) controller.abort()
    }
    this.activeControllersByAgent.clear()
  }

  abortAgent(agentId: string): void {
    this.generationByAgent.set(agentId, (this.generationByAgent.get(agentId) ?? 0) + 1)
    const controllers = this.activeControllersByAgent.get(agentId)
    if (!controllers) return
    for (const controller of controllers) controller.abort()
    this.activeControllersByAgent.delete(agentId)
  }

  generateText(
    agentId: string,
    providerId: string,
    modelId: string,
    prompt: string,
    purpose: Extract<MemoryProviderPurpose, 'extraction' | 'decision' | 'maintenance'>
  ): Promise<string> {
    return this.execute(agentId, providerId, modelId, purpose, (signal) =>
      this.deps.generateText(providerId, modelId, prompt, signal)
    )
  }

  getEmbeddings(
    agentId: string,
    providerId: string,
    modelId: string,
    texts: string[],
    purpose: Extract<
      MemoryProviderPurpose,
      'query-embedding' | 'embedding-batch' | 'embedding-warm'
    >
  ): Promise<number[][]> {
    return this.execute(agentId, providerId, modelId, purpose, (signal) =>
      this.deps.getEmbeddings(providerId, modelId, texts, signal)
    )
  }

  getDimensions(
    agentId: string,
    providerId: string,
    modelId: string
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }> {
    return this.execute(agentId, providerId, modelId, 'dimension', (signal) =>
      this.deps.getDimensions(providerId, modelId, signal)
    )
  }

  private execute<T>(
    agentId: string,
    providerId: string,
    modelId: string,
    purpose: MemoryProviderPurpose,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.stopped) {
      return Promise.reject(
        createMemoryProviderCancellationError('[Memory] provider gateway disposed')
      )
    }
    const controller = new AbortController()
    const generation = this.generationByAgent.get(agentId) ?? 0
    let controllers = this.activeControllersByAgent.get(agentId)
    if (!controllers) {
      controllers = new Set()
      this.activeControllersByAgent.set(agentId, controllers)
    }
    controllers.add(controller)
    const deadline = DEADLINE_MS[purpose]
    let timer: ReturnType<typeof setTimeout> | undefined
    let admissionPending = true
    let raceSettled = false
    let deadlineRecorded = false
    let abortedRecorded = false
    const observeAdmissionQueue = () =>
      this.deps.perfObserver?.observe('queueDepth', this.admissionWaiting)
    const settleAdmission = () => {
      if (!admissionPending) return
      admissionPending = false
      this.admissionWaiting = Math.max(0, this.admissionWaiting - 1)
      observeAdmissionQueue()
    }
    const runOperation = async (): Promise<T> => {
      this.assertCurrent(agentId, generation, controller.signal)
      const key = `${agentId}\0${providerId}\0${modelId}\0${purpose}`
      try {
        this.reserveUnderlyingRequest(key)
      } catch (error) {
        this.deps.diagnostics?.recordProviderAdmissionDecision('capacityRejected')
        throw error
      }
      try {
        this.assertCurrent(agentId, generation, controller.signal)
        this.deps.diagnostics?.recordProviderAdmissionDecision('admitted')
        this.deps.perfObserver?.increment('providerCalls')
        const value = await operation(controller.signal)
        this.assertCurrent(agentId, generation, controller.signal)
        return value
      } finally {
        this.releaseUnderlyingRequest(key)
      }
    }
    this.admissionWaiting += 1
    observeAdmissionQueue()
    let admission: Promise<void>
    try {
      admission = Promise.resolve(
        this.deps.executeWithRateLimit(providerId, { signal: controller.signal, purpose })
      )
    } catch (error) {
      admission = Promise.reject(error)
    }
    const task = admission
      .then(() => {
        settleAdmission()
        return runOperation()
      })
      .catch((error) => {
        if (admissionPending) {
          settleAdmission()
          if (controller.signal.aborted) {
            if (!abortedRecorded && !deadlineRecorded) {
              abortedRecorded = true
              this.deps.diagnostics?.recordProviderRaceEvent('aborted')
            }
          } else {
            this.deps.diagnostics?.recordProviderAdmissionDecision('rateLimited')
          }
        }
        if (
          this.stopped ||
          controller.signal.aborted ||
          (this.generationByAgent.get(agentId) ?? 0) !== generation
        ) {
          throw createMemoryProviderCancellationError('[Memory] provider request aborted')
        }
        throw error
      })
      .finally(() => {
        if (raceSettled) this.deps.diagnostics?.recordProviderRaceEvent('lateSettled')
      })
    void task.catch(() => undefined)
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        deadlineRecorded = true
        this.deps.diagnostics?.recordProviderRaceEvent('deadline')
        reject(
          createMemoryProviderDeadlineError(`[Memory] ${purpose} deadline exceeded (${deadline}ms)`)
        )
        controller.abort()
      }, deadline)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          if (!deadlineRecorded && !abortedRecorded) {
            abortedRecorded = true
            this.deps.diagnostics?.recordProviderRaceEvent('aborted')
          }
          reject(createMemoryProviderCancellationError('[Memory] provider request aborted'))
        },
        { once: true }
      )
    })
    return Promise.race([task, timeout, aborted]).finally(() => {
      raceSettled = true
      settleAdmission()
      if (timer) clearTimeout(timer)
      const current = this.activeControllersByAgent.get(agentId)
      current?.delete(controller)
      if (current?.size === 0) this.activeControllersByAgent.delete(agentId)
    })
  }

  private assertCurrent(agentId: string, generation: number, signal: AbortSignal): void {
    if (
      this.stopped ||
      signal.aborted ||
      (this.generationByAgent.get(agentId) ?? 0) !== generation
    ) {
      throw createMemoryProviderCancellationError('[Memory] provider request aborted')
    }
  }

  private reserveUnderlyingRequest(key: string): void {
    const count = this.unsettledByKey.get(key) ?? 0
    if (
      count >= MAX_UNSETTLED_REQUESTS_PER_KEY ||
      this.unsettledTotal >= MAX_UNSETTLED_REQUESTS_GLOBAL
    ) {
      throw createMemoryProviderCapacityError('[Memory] provider request capacity exhausted')
    }
    this.unsettledByKey.set(key, count + 1)
    this.unsettledTotal += 1
  }

  private releaseUnderlyingRequest(key: string): void {
    const count = this.unsettledByKey.get(key) ?? 0
    if (count <= 1) this.unsettledByKey.delete(key)
    else this.unsettledByKey.set(key, count - 1)
    this.unsettledTotal = Math.max(0, this.unsettledTotal - 1)
  }
}
