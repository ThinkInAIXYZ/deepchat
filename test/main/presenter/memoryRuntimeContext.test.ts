import { describe, expect, it } from 'vitest'

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
