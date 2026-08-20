import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const markstreamVue = vi.hoisted(() => ({
  setKaTeXWorker: vi.fn(),
  clearKaTeXWorker: vi.fn(),
  setMermaidWorker: vi.fn(),
  clearMermaidWorker: vi.fn(),
  terminateWorker: vi.fn(),
  setStreamDiffsWorkerPool: vi.fn(),
  terminateStreamDiffsWorkerPool: vi.fn()
}))

const diffsWorkerModule = vi.hoisted(() => ({
  getOrCreateWorkerPoolSingleton: vi.fn(),
  terminateWorkerPoolSingleton: vi.fn()
}))

vi.mock('markstream-vue', () => markstreamVue)
vi.mock('@pierre/diffs/worker', () => diffsWorkerModule)
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({
  default: class MockDiffsWorker {}
}))
vi.mock('markstream-vue/workers/katexRenderer.worker?worker&inline', () => ({
  default: class MockWorker {
    terminate(): void {}
  }
}))
vi.mock('markstream-vue/workers/mermaidParser.worker?worker&inline', () => ({
  default: class MockWorker {
    terminate(): void {}
  }
}))

import {
  _resetForTesting,
  areMarkdownWorkersInitialized,
  ensureMarkdownWorkers
} from '@/lib/markdownWorkerLifecycle'

const mockPool = {
  isWorkingPool: () => true,
  initialize: vi.fn(),
  terminate: vi.fn()
}

describe('markdownWorkerLifecycle stream-diffs worker pool', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
    diffsWorkerModule.getOrCreateWorkerPoolSingleton.mockReturnValue(mockPool)
  })

  afterEach(() => {
    _resetForTesting()
  })

  it('injects the worker pool once across repeated ensureMarkdownWorkers calls', async () => {
    await ensureMarkdownWorkers()
    await ensureMarkdownWorkers()

    expect(diffsWorkerModule.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(1)
    expect(diffsWorkerModule.getOrCreateWorkerPoolSingleton).toHaveBeenCalledWith(
      expect.objectContaining({
        poolOptions: expect.objectContaining({ poolSize: 4 }),
        highlighterOptions: { theme: { dark: 'vitesse-dark', light: 'vitesse-light' } }
      })
    )
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenCalledTimes(1)
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenCalledWith(mockPool)
  })

  it('retries after a failed pool creation and clears the singleton', async () => {
    diffsWorkerModule.getOrCreateWorkerPoolSingleton
      .mockImplementationOnce(() => {
        throw new Error('pool creation failed')
      })
      .mockReturnValue(mockPool)

    await ensureMarkdownWorkers()
    expect(markstreamVue.setStreamDiffsWorkerPool).not.toHaveBeenCalled()
    expect(diffsWorkerModule.terminateWorkerPoolSingleton).toHaveBeenCalled()

    await ensureMarkdownWorkers()
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenCalledTimes(1)
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenCalledWith(mockPool)
  })

  it('terminates the pool and resets the lifecycle on cleanup', async () => {
    await ensureMarkdownWorkers()
    expect(areMarkdownWorkersInitialized()).toBe(true)

    _resetForTesting()

    expect(markstreamVue.terminateStreamDiffsWorkerPool).toHaveBeenCalled()
    expect(areMarkdownWorkersInitialized()).toBe(false)
  })

  it('re-injects a fresh pool after a lifecycle reset', async () => {
    await ensureMarkdownWorkers()
    _resetForTesting()

    await ensureMarkdownWorkers()

    expect(diffsWorkerModule.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(2)
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenCalledTimes(2)
    expect(markstreamVue.setStreamDiffsWorkerPool).toHaveBeenLastCalledWith(mockPool)
  })
})
