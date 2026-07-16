import { describe, expect, it } from 'vitest'

import { FakeAuditRepository } from './support/memoryFakes'

function insertAudit(
  repository: FakeAuditRepository,
  id: string,
  eventType: string,
  createdAt: number,
  agentId = 'a'
): void {
  repository.insert({
    id,
    agentId,
    eventType,
    actorType: eventType === 'memory/forget' ? 'runtime' : 'scheduler',
    status: 'completed',
    inputRefs: eventType === 'memory/forget' ? { memoryId: 'm1' } : {},
    outputRefs: eventType === 'memory/forget' ? { memoryId: 'm1' } : {},
    createdAt
  })
}

describe('operational memory audit retention', () => {
  it('keeps the newest rows across the exact allowlist and honors the delete batch cap', () => {
    const repository = new FakeAuditRepository()
    const eventTypes = [
      'memory/maintenance_llm',
      'memory/reflect',
      'memory/repair',
      'memory/conflict_repair',
      'memory/extract'
    ]
    for (let index = 0; index < 8; index += 1) {
      insertAudit(repository, `operational-${index}`, eventTypes[index % eventTypes.length], index)
    }

    expect(repository.pruneOperationalEvents('a', 3, 2)).toBe(2)
    expect(repository.pruneOperationalEvents('a', 3, 500)).toBe(3)
    expect(repository.listByAgent('a', { limit: 100 }).map((row) => row.id)).toEqual([
      'operational-7',
      'operational-6',
      'operational-5'
    ])
  })

  it('preserves causal, persona, unknown, and other-agent rows without changing forget semantics', () => {
    const repository = new FakeAuditRepository()
    const preservedTypes = [
      'memory/forget',
      'memory/add',
      'memory/archive',
      'memory/restore',
      'memory/manual_edit',
      'memory/challenge_resolved',
      'persona/evolve',
      'memory/future_event'
    ]
    preservedTypes.forEach((eventType, index) =>
      insertAudit(repository, `preserved-${index}`, eventType, index)
    )
    insertAudit(repository, 'other-agent-operational', 'memory/extract', 100, 'b')

    const beforeForget = repository.hasForgetEvent('a', 'm1')
    expect(repository.pruneOperationalEvents('a', 0, 500)).toBe(0)
    expect(repository.hasForgetEvent('a', 'm1')).toBe(beforeForget)
    expect(repository.listByAgent('a', { limit: 100 })).toHaveLength(preservedTypes.length)
    expect(repository.listByAgent('b', { limit: 100 }).map((row) => row.id)).toEqual([
      'other-agent-operational'
    ])
  })
})
