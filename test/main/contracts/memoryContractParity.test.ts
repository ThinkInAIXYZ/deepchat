import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import {
  MemoryUpdateReasonSchema,
  memoryUpdatedEvent,
  type MemoryUpdateReason as SharedMemoryUpdateReason
} from '@shared/contracts/events/memory.events'
import {
  MemoryAuditEventSchema,
  MemoryHealthRecentFailureSchema,
  memoryListAuditEventsRoute,
  memoryListRoute
} from '@shared/contracts/routes/memory.routes'
import {
  AGENT_MEMORY_AUDIT_ACTOR_TYPES,
  AGENT_MEMORY_AUDIT_FAILURE_STATUSES,
  AGENT_MEMORY_AUDIT_STATUSES,
  type AgentMemoryAuditActorType as SharedAuditActorType,
  type AgentMemoryAuditStatus as SharedAuditStatus,
  isSafeAgentId as isSharedSafeAgentId
} from '@shared/types/agent-memory'
import { isSafeAgentId as isPresenterSafeAgentId } from '@/memory'
import type {
  AgentMemoryAuditActorType as DomainAuditActorType,
  AgentMemoryAuditStatus as DomainAuditStatus
} from '@/memory/domain/audit'
import type { MemoryUpdateReason as PresenterMemoryUpdateReason } from '@/memory/types'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type SchemaMemoryUpdateReason = z.infer<typeof MemoryUpdateReasonSchema>
type EventMemoryUpdateReason = z.infer<typeof memoryUpdatedEvent.payload>['reason']
type AuditEvent = z.infer<typeof MemoryAuditEventSchema>
type AuditListInput = z.infer<typeof memoryListAuditEventsRoute.input>

const reasonTypeParity: [
  Equal<SharedMemoryUpdateReason, SchemaMemoryUpdateReason>,
  Equal<SharedMemoryUpdateReason, EventMemoryUpdateReason>,
  Equal<SharedMemoryUpdateReason, PresenterMemoryUpdateReason>
] = [true, true, true]

const auditTypeParity: [
  Equal<SharedAuditActorType, DomainAuditActorType>,
  Equal<SharedAuditStatus, DomainAuditStatus>,
  Equal<SharedAuditActorType, AuditEvent['actorType']>,
  Equal<SharedAuditStatus, AuditEvent['status']>,
  Equal<SharedAuditActorType | undefined, AuditListInput['actorType']>,
  Equal<SharedAuditStatus | undefined, AuditListInput['status']>
] = [true, true, true, true, true, true]

describe('memory contract single sources of truth', () => {
  it('keeps update reasons type-identical and rejects unknown wire reasons', () => {
    expect(reasonTypeParity).toEqual([true, true, true])
    expect(
      memoryUpdatedEvent.payload.safeParse({
        agentId: 'agent-a',
        reason: 'extract',
        version: 1
      }).success
    ).toBe(true)
    expect(
      memoryUpdatedEvent.payload.safeParse({
        agentId: 'agent-a',
        reason: 'future-reason',
        version: 1
      }).success
    ).toBe(false)
  })

  it('keeps route, shared, and presenter agent-id validation aligned', () => {
    const cases: Array<[unknown, boolean]> = [
      ['a', true],
      ['x'.repeat(128), true],
      ['deepchat-Ab12_xy', true],
      ['', false],
      ['x'.repeat(129), false],
      ['.', false],
      ['..', false],
      ['a/b', false],
      ['a\\b', false],
      ['a b', false],
      ['你好', false],
      [null, false],
      [1, false]
    ]

    for (const [value, expected] of cases) {
      expect(isSharedSafeAgentId(value)).toBe(expected)
      expect(isPresenterSafeAgentId(value)).toBe(expected)
      expect(memoryListRoute.input.safeParse({ agentId: value }).success).toBe(expected)
    }
  })

  it('keeps audit actor and status types and wire schemas aligned', () => {
    expect(auditTypeParity).toEqual([true, true, true, true, true, true])
    expect(AGENT_MEMORY_AUDIT_ACTOR_TYPES).toEqual(['scheduler', 'user', 'runtime'])
    expect(AGENT_MEMORY_AUDIT_STATUSES).toEqual(['completed', 'skipped', 'failed'])
    expect(AGENT_MEMORY_AUDIT_FAILURE_STATUSES).toEqual(['failed', 'skipped'])

    const actors: Array<[unknown, boolean]> = [
      ['scheduler', true],
      ['user', true],
      ['runtime', true],
      ['system', false],
      ['', false],
      [null, false]
    ]
    const statuses: Array<[unknown, boolean]> = [
      ['completed', true],
      ['skipped', true],
      ['failed', true],
      ['pending', false],
      ['', false],
      [null, false]
    ]

    for (const [actorType, expected] of actors) {
      expect(MemoryAuditEventSchema.shape.actorType.safeParse(actorType).success).toBe(expected)
      expect(memoryListAuditEventsRoute.input.shape.actorType.safeParse(actorType).success).toBe(
        expected
      )
    }
    for (const [status, expected] of statuses) {
      expect(MemoryAuditEventSchema.shape.status.safeParse(status).success).toBe(expected)
      expect(memoryListAuditEventsRoute.input.shape.status.safeParse(status).success).toBe(expected)
      expect(MemoryHealthRecentFailureSchema.shape.status.safeParse(status).success).toBe(
        status === 'failed' || status === 'skipped'
      )
    }

    expect(memoryListAuditEventsRoute.input.shape.actorType.safeParse(undefined).success).toBe(true)
    expect(memoryListAuditEventsRoute.input.shape.status.safeParse(undefined).success).toBe(true)
  })
})
