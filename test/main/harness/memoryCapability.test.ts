import { load } from '@arcships/rutis/testing'
import { expect, it } from 'vitest'
import memoryPlugin, { type MemoryCapability } from '../../../src/harness/plugins/memory'
import {
  createFakeRepository,
  enabledConfig,
  FakeDirectiveRepository,
  FakeVectorStore
} from '../memory/support/memoryFakes'

it('Memory unload fences admitted extraction and cannot reopen its retired attachment', async () => {
  const plugin = await load(memoryPlugin, { strict: false })
  const capability = plugin.service<MemoryCapability>('deepchatMemoryCapability')
  const repository = createFakeRepository()
  const request = Promise.withResolvers<string>()
  const requested = Promise.withResolvers<void>()
  const fenced = Promise.withResolvers<void>()
  const deps = {
    repository,
    directiveRepository: new FakeDirectiveRepository(),
    resolveAgentConfig: () => enabledConfig,
    executeWithRateLimit: async () => {},
    getEmbeddings: async () => [],
    getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
    generateText: async () => {
      requested.resolve()
      return await request.promise
    },
    createVectorStore: async () => new FakeVectorStore(),
    resetVectorStore: async () => {},
    markVectorStoreQuarantined() {}
  }
  const service = capability.open(deps)
  const token = service.captureExecutionToken('a')
  const extraction = service.extractAndStore({
    agentId: 'a',
    spanText: 'User: I prefer Redis',
    model: { providerId: 'p', modelId: 'm' }
  })
  capability.bindIngestion({
    afterTurnSettled() {},
    afterCompactionApplyReturned() {},
    resumeIngestion() {},
    async drainAndFence() {
      fenced.resolve()
      await extraction
      return { timedOut: false, pendingSessions: [] }
    }
  })
  try {
    await requested.promise
    expect(service.canContinueExecution(token)).toBe(true)
    const unloading = plugin.unload()
    await fenced.promise
    expect(service.canContinueExecution(token)).toBe(false)
    request.resolve('[{"kind":"semantic","content":"user prefers Redis","importance":0.8}]')
    expect(await extraction).toMatchObject({ ok: false })
    await unloading
    expect(repository.countByAgent('a')).toBe(0)
    expect(() => capability.open(deps)).toThrow('cannot reopen')
    expect(() => capability.start()).toThrow('unavailable')
    const replacement = await load(memoryPlugin, { strict: false })
    try {
      const next = replacement.service<MemoryCapability>('deepchatMemoryCapability').open(deps)
      expect(next.canContinueExecution(token)).toBe(false)
      expect(next.canContinueExecution(next.captureExecutionToken('a'))).toBe(true)
    } finally {
      await replacement.unload()
    }
  } finally {
    request.resolve('[]')
    await plugin.unload()
  }
})
