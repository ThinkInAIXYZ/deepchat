import type { LLM_EMBEDDING_ATTRS } from '@shared/presenter'

import type { MemoryPresenterDeps } from '../types'

export type MemoryProviderPurpose =
  | 'query-embedding'
  | 'dimension'
  | 'embedding-batch'
  | 'embedding-warm'
  | 'extraction'
  | 'decision'
  | 'maintenance'

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

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export class MemoryProviderGateway {
  private readonly activeControllersByAgent = new Map<string, Set<AbortController>>()
  private readonly generationByAgent = new Map<string, number>()
  private readonly unsettledByKey = new Map<string, number>()
  private unsettledTotal = 0
  private stopped = false

  constructor(private readonly deps: MemoryPresenterDeps) {}

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
    if (this.stopped) return Promise.reject(createAbortError('[Memory] provider gateway disposed'))
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
    const runOperation = async (): Promise<T> => {
      this.assertCurrent(agentId, generation, controller.signal)
      const key = `${agentId}\0${providerId}\0${modelId}\0${purpose}`
      this.reserveUnderlyingRequest(key)
      try {
        const value = await operation(controller.signal)
        this.assertCurrent(agentId, generation, controller.signal)
        return value
      } finally {
        this.releaseUnderlyingRequest(key)
      }
    }
    const task = Promise.resolve(
      this.deps.executeWithRateLimit(providerId, { signal: controller.signal, purpose })
    ).then(runOperation)
    void task.catch(() => undefined)
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(createAbortError(`[Memory] ${purpose} deadline exceeded (${deadline}ms)`))
        controller.abort()
      }, deadline)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(createAbortError('[Memory] provider request aborted')),
        { once: true }
      )
    })
    return Promise.race([task, timeout, aborted]).finally(() => {
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
      throw createAbortError('[Memory] provider request aborted')
    }
  }

  private reserveUnderlyingRequest(key: string): void {
    const count = this.unsettledByKey.get(key) ?? 0
    if (
      count >= MAX_UNSETTLED_REQUESTS_PER_KEY ||
      this.unsettledTotal >= MAX_UNSETTLED_REQUESTS_GLOBAL
    ) {
      throw createAbortError('[Memory] provider request capacity exhausted')
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
