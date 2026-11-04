import { vi } from 'vitest'
import {
  createDeepChatAgentHarness as assembleHarness,
  type DeepChatAgentHarness,
  type DeepChatHarnessDependencies
} from '../../src/main/agent/deepchat/harness'
import type { DeepChatAgentRuntime } from '../../src/main/agent/deepchat/instance/deepChatAgentRuntime'
import type { MemoryRuntimeCoordinator } from '../../src/main/agent/deepchat/memory/memoryRuntimeCoordinator'

const constructed = vi.hoisted(() => ({
  runtime: null as DeepChatAgentRuntime | null,
  memory: null as MemoryRuntimeCoordinator | null
}))

// Observe construction of real owners for lifecycle fault injection without exposing them in production.
vi.mock('@/agent/deepchat/instance/deepChatAgentRuntime', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/main/agent/deepchat/instance/deepChatAgentRuntime')
    >()
  return {
    ...actual,
    DeepChatAgentRuntime: class extends actual.DeepChatAgentRuntime {
      constructor(...args: ConstructorParameters<typeof actual.DeepChatAgentRuntime>) {
        super(...args)
        constructed.runtime = this
      }
    }
  }
})

vi.mock('@/agent/deepchat/memory/memoryRuntimeCoordinator', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/main/agent/deepchat/memory/memoryRuntimeCoordinator')
    >()
  return {
    ...actual,
    MemoryRuntimeCoordinator: class extends actual.MemoryRuntimeCoordinator {
      constructor(...args: ConstructorParameters<typeof actual.MemoryRuntimeCoordinator>) {
        super(...args)
        constructed.memory = this
      }
    }
  }
})

const owners = new WeakMap<
  DeepChatAgentHarness,
  {
    runtime: DeepChatAgentRuntime
    memory: MemoryRuntimeCoordinator
  }
>()

export function createDeepChatAgentHarness(
  dependencies: DeepChatHarnessDependencies
): DeepChatAgentHarness {
  constructed.runtime = null
  constructed.memory = null
  const harness = assembleHarness(dependencies)
  if (!constructed.runtime || !constructed.memory)
    throw new Error('Harness owners were not constructed')
  owners.set(harness, { runtime: constructed.runtime, memory: constructed.memory })
  return harness
}

export function getHarnessOwners(harness: DeepChatAgentHarness) {
  const value = owners.get(harness)
  if (!value) throw new Error('Harness was not assembled by the fixture')
  return value
}
