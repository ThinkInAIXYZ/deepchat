import { describe, expect, it, vi } from 'vitest'

import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { MemoryRuntimeContext } from '@/presenter/memoryPresenter/context'
import type {
  MemoryAgentPolicyPort,
  MemoryProviderControlPort
} from '@/presenter/memoryPresenter/ports'

const providerControl: MemoryProviderControlPort = {
  abortAgent: () => undefined,
  abortAll: () => undefined
}

function makeContext(policy: MemoryAgentPolicyPort): MemoryRuntimeContext {
  return new MemoryRuntimeContext({ policy, providerControl })
}

function enabledConfig(memoryEmbedding?: {
  providerId: string
  modelId: string
}): DeepChatAgentConfig {
  return { memoryEnabled: true, memoryEmbedding } as DeepChatAgentConfig
}

describe('MemoryRuntimeContext policy compatibility', () => {
  it('allows a missing managed-agent callback and preserves explicit callback results', () => {
    expect(makeContext({ resolveAgentConfig: () => null }).isManagedAgent('agent-a')).toBe(true)
    expect(
      makeContext({ resolveAgentConfig: () => null, isManagedAgent: () => true }).isManagedAgent(
        'agent-a'
      )
    ).toBe(true)
    expect(
      makeContext({ resolveAgentConfig: () => null, isManagedAgent: () => false }).isManagedAgent(
        'agent-a'
      )
    ).toBe(false)
  })

  it('does not turn invalid nullish callback results into managed access', () => {
    const undefinedCallback = (() => undefined) as unknown as (agentId: string) => boolean
    const nullCallback = (() => null) as unknown as (agentId: string) => boolean

    expect(
      makeContext({
        resolveAgentConfig: () => null,
        isManagedAgent: undefinedCallback
      }).isManagedAgent('agent-a')
    ).toBeUndefined()
    expect(
      makeContext({ resolveAgentConfig: () => null, isManagedAgent: nullCallback }).isManagedAgent(
        'agent-a'
      )
    ).toBeNull()
  })

  it('rejects missing, malformed, and mismatched embedding identities without throwing', () => {
    const missing = makeContext({ resolveAgentConfig: () => enabledConfig() })
    const configured = makeContext({
      resolveAgentConfig: () => enabledConfig({ providerId: 'provider-a', modelId: 'model-a' })
    })

    expect(
      missing.canUseCurrentMemoryEmbedding('agent-a', {
        providerId: undefined,
        modelId: 'model-a'
      } as unknown as {
        providerId: string
        modelId: string
      })
    ).toBe(false)
    expect(
      configured.canUseCurrentMemoryEmbedding('agent-a', {
        providerId: 'provider-b',
        modelId: 'model-a'
      })
    ).toBe(false)
    expect(
      configured.canUseCurrentMemoryEmbedding('agent-a', {
        providerId: 'provider-a',
        modelId: 'model-b'
      })
    ).toBe(false)
    expect(
      configured.canUseCurrentMemoryEmbedding('agent-a', {
        providerId: 'provider-a',
        modelId: 'model-a'
      })
    ).toBe(true)
  })
})

describe('MemoryRuntimeContext execution epoch', () => {
  function makeMutableContext(initialConfig: DeepChatAgentConfig) {
    let config = initialConfig
    const abortAgent = vi.fn()
    const ctx = new MemoryRuntimeContext({
      policy: { resolveAgentConfig: () => config },
      providerControl: { abortAgent, abortAll: vi.fn() }
    })
    return {
      ctx,
      abortAgent,
      setConfig(nextConfig: DeepChatAgentConfig) {
        config = nextConfig
      }
    }
  }

  it('seeds first observation and ignores equal or non-execution config changes', () => {
    const initial = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'provider-a', modelId: 'model-a' },
      memoryExtractionModel: { providerId: 'provider-a', modelId: 'extract-a' },
      personaEvolutionEnabled: false
    } as DeepChatAgentConfig
    const { ctx, abortAgent, setConfig } = makeMutableContext(initial)

    expect(ctx.noteAgentExecutionConfig('agent-a', initial)).toBe('seeded')
    const first = ctx.captureOperationFence('agent-a')
    expect(first.generation).toBe(0)
    expect(ctx.listObservedExecutionAgentIds()).toEqual(['agent-a'])
    expect(ctx.noteAgentExecutionConfig('agent-a', initial)).toBe('unchanged')

    const policyOnlyChange = {
      ...initial,
      memoryExtractionModel: { providerId: 'provider-b', modelId: 'extract-b' },
      personaEvolutionEnabled: true
    } as DeepChatAgentConfig
    setConfig(policyOnlyChange)
    expect(ctx.noteAgentExecutionConfig('agent-a', policyOnlyChange)).toBe('unchanged')
    const afterPolicyOnlyChange = ctx.captureOperationFence('agent-a')

    expect(afterPolicyOnlyChange.generation).toBe(first.generation)
    expect(ctx.isOperationFenceCurrent(first)).toBe(true)
    expect(abortAgent).not.toHaveBeenCalled()
  })

  it('advances exactly once for each enabled A-to-B-to-A transition', () => {
    const { ctx, abortAgent, setConfig } = makeMutableContext({
      memoryEnabled: true
    } as DeepChatAgentConfig)
    expect(
      ctx.noteAgentExecutionConfig('agent-a', { memoryEnabled: true } as DeepChatAgentConfig)
    ).toBe('seeded')
    const original = ctx.captureOperationFence('agent-a')

    const disabledConfig = { memoryEnabled: false } as DeepChatAgentConfig
    setConfig(disabledConfig)
    expect(ctx.noteAgentExecutionConfig('agent-a', disabledConfig)).toBe('changed')
    const disabled = ctx.captureOperationFence('agent-a')
    expect(disabled.generation).toBe(original.generation + 1)
    expect(abortAgent).toHaveBeenCalledTimes(1)

    const reenabledConfig = { memoryEnabled: true } as DeepChatAgentConfig
    setConfig(reenabledConfig)
    expect(ctx.noteAgentExecutionConfig('agent-a', reenabledConfig)).toBe('changed')
    const reenabled = ctx.captureOperationFence('agent-a')
    expect(reenabled.generation).toBe(disabled.generation + 1)
    expect(abortAgent).toHaveBeenCalledTimes(2)
    expect(ctx.isOperationFenceCurrent(original)).toBe(false)
    expect(ctx.canContinueOperation(reenabled)).toBe(true)

    expect(ctx.noteAgentExecutionConfig('agent-a', reenabledConfig)).toBe('unchanged')
    expect(ctx.captureOperationFence('agent-a')).toEqual(reenabled)
    expect(abortAgent).toHaveBeenCalledTimes(2)
  })

  it('advances for embedding A-to-B-to-A and retains the epoch across cleanup', () => {
    const embeddingA = { providerId: 'provider-a', modelId: 'model-a' }
    const embeddingB = { providerId: 'provider-b', modelId: 'model-b' }
    const { ctx, abortAgent, setConfig } = makeMutableContext(enabledConfig(embeddingA))
    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(embeddingA))).toBe('seeded')
    const original = ctx.captureOperationFence('agent-a')

    setConfig(enabledConfig(embeddingB))
    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(embeddingB))).toBe('changed')
    const changed = ctx.captureOperationFence('agent-a')
    setConfig(enabledConfig(embeddingA))
    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(embeddingA))).toBe('changed')
    const restored = ctx.captureOperationFence('agent-a')

    expect(changed.generation).toBe(original.generation + 1)
    expect(restored.generation).toBe(changed.generation + 1)
    expect(abortAgent).toHaveBeenCalledTimes(2)

    ctx.cleanupAgent('agent-a')
    expect(ctx.listObservedExecutionAgentIds()).toEqual([])
    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(embeddingA))).toBe('seeded')
    const afterCleanup = ctx.captureOperationFence('agent-a')
    expect(afterCleanup.generation).toBe(restored.generation)
    expect(ctx.isOperationFenceCurrent(original)).toBe(false)
    expect(abortAgent).toHaveBeenCalledTimes(2)
  })

  it('distinguishes embedding identities containing separator characters', () => {
    const first = { providerId: 'provider:region', modelId: 'model' }
    const second = { providerId: 'provider', modelId: 'region:model' }
    const { ctx, abortAgent, setConfig } = makeMutableContext(enabledConfig(first))

    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(first))).toBe('seeded')
    const original = ctx.captureOperationFence('agent-a')
    setConfig(enabledConfig(second))
    expect(ctx.noteAgentExecutionConfig('agent-a', enabledConfig(second))).toBe('changed')

    expect(ctx.captureOperationFence('agent-a').generation).toBe(original.generation + 1)
    expect(abortAgent).toHaveBeenCalledOnce()
  })

  it('captures an existing execution epoch without resolving configuration', () => {
    const resolveAgentConfig = vi.fn(() => enabledConfig())
    const ctx = new MemoryRuntimeContext({
      policy: { resolveAgentConfig },
      providerControl: { abortAgent: vi.fn(), abortAll: vi.fn() }
    })

    expect(ctx.captureOperationFence('agent-a')).toEqual({ agentId: 'agent-a', generation: 0 })
    expect(ctx.captureOperationFence('agent-a')).toEqual({ agentId: 'agent-a', generation: 0 })
    expect(resolveAgentConfig).not.toHaveBeenCalled()
    expect(ctx.listObservedExecutionAgentIds()).toEqual([])
  })
})
