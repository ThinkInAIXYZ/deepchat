import { describe, expect, it, vi } from 'vitest'

import {
  createCapabilityFragment,
  createMemoryDiagnosticsProbe,
  createMemoryServiceHarness
} from './serviceHarness'
import { createFakeRepository, createFakeRepositoryHarness } from './support/memoryFakes'

describe('memory service harness builders', () => {
  it('splits repository capabilities over shared state and composes facade dependencies explicitly', () => {
    const harness = createFakeRepositoryHarness()
    const inserted = harness.mutation.insertClaimUnlessTombstoned({
      id: 'memory-1',
      agentId: 'agent',
      kind: 'semantic',
      content: 'bounded test state'
    })

    expect(inserted).not.toBeNull()
    expect(harness.read.getById(inserted!.id)).toBe(inserted)
    expect('insertClaimUnlessTombstoned' in harness.read).toBe(false)
    expect('getHealthStats' in harness.embedding).toBe(false)

    const facadeRepository = createFakeRepository()
    facadeRepository.insert({
      id: 'memory-2',
      agentId: 'agent',
      kind: 'semantic',
      content: 'facade smoke'
    })
    expect(facadeRepository.getById('memory-2')?.content).toBe('facade smoke')
  })

  it('composes only requested capability fragments and preserves method ownership', () => {
    const owner = {
      value: 2,
      read: vi.fn(function (this: { value: number }) {
        return this.value
      }),
      write: vi.fn()
    }
    const harness = createMemoryServiceHarness({
      read: createCapabilityFragment(owner, ['read']),
      mutation: createCapabilityFragment(owner, ['write'])
    })
    const read = harness.compose(['read'])
    expect(read.read()).toBe(2)
    expect('write' in read).toBe(false)
  })

  it('provides content-agnostic diagnostics probes', () => {
    const diagnostics = createMemoryDiagnosticsProbe()
    diagnostics.observeEmbeddingBacklog(3, 1)
    expect(diagnostics.samples).toEqual([{ method: 'observeEmbeddingBacklog', args: [3, 1] }])
  })
})
