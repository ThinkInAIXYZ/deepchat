import { definePlugin } from '@arcships/rutis'
import logger from '@shared/logger'
import { MemoryService, type MemoryServicePort } from '@/memory'
import type { MemoryServiceDeps } from '@/memory/types'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'

export class MemoryCapability {
  private service: MemoryServicePort | undefined
  private ingestion: MemoryIngestionObserver | undefined
  private retirement: Promise<void> | undefined

  constructor(private readonly signal: AbortSignal) {}

  open(deps: MemoryServiceDeps): MemoryServicePort {
    if (this.signal.aborted || this.retirement || this.service)
      throw new Error('Memory capability cannot reopen')
    // The shared transaction owner must stay local; never serialize repository callbacks.
    if (typeof deps?.repository?.runInTransaction !== 'function')
      throw new Error('Memory capability requires owner-local Store ports')
    return (this.service = new MemoryService(deps))
  }

  bindIngestion(observer: MemoryIngestionObserver): void {
    if (this.signal.aborted || this.retirement || !this.service || this.ingestion)
      throw new Error('Memory ingestion cannot attach')
    this.ingestion = observer
  }

  start(): void {
    if (this.signal.aborted || this.retirement || !this.service || !this.ingestion)
      throw new Error('Memory capability is unavailable')
    this.ingestion.resumeIngestion()
    this.service.startBackgroundMaintenance()
  }

  pause(): void {
    this.service?.stopBackgroundMaintenance()
  }

  async drain(): Promise<void> {
    const ingestion = await this.ingestion?.drainAndFence()
    if (ingestion?.timedOut)
      throw new Error(
        `Memory ingestion did not drain for sessions: ${ingestion.pendingSessions.join(', ')}`
      )
    const agents = await this.service?.drainBackgroundMaintenance()
    if (agents?.length)
      throw new Error(`Memory maintenance did not drain for agents: ${agents.join(', ')}`)
  }

  stop(): Promise<void> {
    if (this.retirement) return this.retirement
    this.retirement = (async () => {
      // Fence ingestion before disposing the facade; disposal aborts pending Provider work.
      const ingestion = (() => {
        try {
          return this.ingestion?.drainAndFence()
        } catch (error) {
          return Promise.reject(error)
        }
      })()
      const outcomes = await Promise.allSettled([this.service?.dispose(), ingestion] as const)
      const errors = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason] : []
      )
      const drained = outcomes[1]
      if (drained.status === 'fulfilled' && drained.value?.timedOut)
        logger.warn('[Memory] Late ingestion remains fenced', drained.value)
      if (errors.length) throw new AggregateError(errors, 'Memory capability did not retire')
    })()
    return this.retirement
  }
}

export default definePlugin({
  name: 'deepchat-memory',
  provides: {
    deepchatMemoryCapability: {
      open: 'sync',
      bindIngestion: 'sync',
      start: 'sync',
      pause: 'sync',
      drain: 'async',
      stop: 'async'
    }
  },
  apply(ctx) {
    const memory = new MemoryCapability(ctx.signal)
    ctx.signal.addEventListener('abort', () => void memory.stop().catch(() => {}), { once: true })
    ctx.effect(() => memory.stop())
    ctx.provide('deepchatMemoryCapability', memory)
  }
})
