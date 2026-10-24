import { z } from 'zod'
import { types as utilTypes } from 'node:util'
import type { NumberDistribution } from '../../main/lib/boundedNumberRing'

export const DEFAULT_AGENT_INVOCATION_CAPACITY = 6
export const DEFAULT_AGENT_INVOCATION_MAX_PENDING = 256
const MAX_AGENT_INVOCATION_IDENTIFIER_LENGTH = 256

export interface AgentInvocationPermit {
  release(): void
}

export type AgentInvocationLeaseState = 'suspended' | 'acquiring' | 'active' | 'released'

export interface AgentInvocationLease {
  readonly state: AgentInvocationLeaseState
  resume(options?: { signal?: AbortSignal }): Promise<void>
  suspend(): void
  release(): void
}

export interface AgentInvocationAdmissionOptions {
  ownerId: string
  maxActiveForOwner?: number
  signal?: AbortSignal
  correlation?: AgentInvocationAdmissionCorrelation
}

export interface AgentInvocationAdmissionCorrelation {
  kind: 'live_delegation'
  parentSessionId: string
  delegationId: string
  turnId: string
}

export interface AgentInvocationAdmissionSnapshot {
  capacity: number
  active: number
  pending: number
  pendingOwners: number
  closed: boolean
  activeHighWater: number
  pendingHighWater: number
  granted: number
  rejected: number
  observationsDropped: number
  waitMs: NumberDistribution
  holdMs: NumberDistribution
}

type AgentInvocationAdmissionState = Pick<
  AgentInvocationAdmissionSnapshot,
  'capacity' | 'active' | 'pending'
>

export type AgentInvocationAdmissionObservation =
  | ({
      type: 'queued'
      acquisitionSeq: number
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'granted'
      acquisitionSeq: number
      waitMs?: number
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'released'
      acquisitionSeq: number
      holdMs?: number
      reason: 'permit_released' | 'lease_suspended' | 'lease_released'
      active: number
      pending: number
    } & AgentInvocationAdmissionCorrelation)
  | ({
      type: 'rejected'
      acquisitionSeq: number
      waitMs?: number
      reason: 'queue_full' | 'aborted' | 'closed'
    } & AgentInvocationAdmissionCorrelation &
      AgentInvocationAdmissionState)
  | ({
      type: 'closed'
    } & Omit<AgentInvocationAdmissionSnapshot, 'pendingOwners' | 'closed'>)

export interface AgentInvocationAdmissionDiagnosticsOptions {
  observe?: (observation: AgentInvocationAdmissionObservation) => void | Promise<void>
  observationsEnabled?: () => boolean
}

export interface AgentInvocationAdmissionPort {
  acquire(options: AgentInvocationAdmissionOptions): Promise<AgentInvocationPermit>
  createLease(options: AgentInvocationAdmissionOptions): AgentInvocationLease
  run<T>(options: AgentInvocationAdmissionOptions, task: () => Promise<T>): Promise<T>
}

export class AgentInvocationAdmissionClosedError extends Error {
  constructor(message = 'Agent invocation admission is closed.') {
    super(message)
    this.name = 'AgentInvocationAdmissionClosedError'
  }
}

export class AgentInvocationAdmissionAbortedError extends Error {
  constructor() {
    super('Agent invocation admission was cancelled while queued.')
    this.name = 'AgentInvocationAdmissionAbortedError'
  }
}

export class AgentInvocationAdmissionQueueFullError extends Error {
  constructor(maxPending: number) {
    super(`Agent invocation admission queue is full (${maxPending} pending).`)
    this.name = 'AgentInvocationAdmissionQueueFullError'
  }
}

export interface InternalAgentInvocationPermit extends AgentInvocationPermit {
  releaseWithReason(reason: 'permit_released' | 'lease_suspended' | 'lease_released'): void
}

export function snapshotAdmissionCorrelation(
  correlation: AgentInvocationAdmissionCorrelation | undefined
): AgentInvocationAdmissionCorrelation | undefined {
  if (!correlation) return undefined
  try {
    if (typeof correlation !== 'object' || utilTypes.isProxy(correlation)) return undefined
    const prototype = Object.getPrototypeOf(correlation)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const kind = Object.getOwnPropertyDescriptor(correlation, 'kind')
    const parentSessionId = Object.getOwnPropertyDescriptor(correlation, 'parentSessionId')
    const delegationId = Object.getOwnPropertyDescriptor(correlation, 'delegationId')
    const turnId = Object.getOwnPropertyDescriptor(correlation, 'turnId')
    if (
      !kind ||
      !('value' in kind) ||
      kind.value !== 'live_delegation' ||
      !parentSessionId ||
      !('value' in parentSessionId) ||
      !isBoundedAdmissionIdentifier(parentSessionId.value) ||
      !delegationId ||
      !('value' in delegationId) ||
      !isBoundedAdmissionIdentifier(delegationId.value) ||
      !turnId ||
      !('value' in turnId) ||
      !isBoundedAdmissionIdentifier(turnId.value)
    ) {
      return undefined
    }
    return {
      kind: kind.value,
      parentSessionId: parentSessionId.value,
      delegationId: delegationId.value,
      turnId: turnId.value
    }
  } catch {
    return undefined
  }
}

export function normalizeAdmissionOwnerId(ownerId: string): string {
  const normalized = ownerId.trim()
  if (!normalized || normalized.length > MAX_AGENT_INVOCATION_IDENTIFIER_LENGTH) {
    throw new Error(
      `Agent invocation ownerId must contain 1 to ${MAX_AGENT_INVOCATION_IDENTIFIER_LENGTH} characters.`
    )
  }
  return normalized
}

function isBoundedAdmissionIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AGENT_INVOCATION_IDENTIFIER_LENGTH
  )
}

export function normalizeAdmissionOwnerLimit(
  requested: number | undefined,
  capacity: number
): number {
  if (requested === undefined) {
    return capacity
  }
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new Error('Agent invocation owner limit must be a positive safe integer.')
  }
  return Math.min(requested, capacity)
}

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const DurationSchema = z.number().finite().nonnegative()
const DistributionSchema = z
  .object({
    samples: CountSchema,
    p50: DurationSchema.nullable(),
    p95: DurationSchema.nullable(),
    max: DurationSchema.nullable()
  })
  .strict()
const stateShape = { capacity: CountSchema, active: CountSchema, pending: CountSchema }
const correlationShape = {
  kind: z.literal('live_delegation'),
  parentSessionId: z.string().min(1).max(256),
  delegationId: z.string().min(1).max(256),
  turnId: z.string().min(1).max(256),
  acquisitionSeq: CountSchema
}
const diagnosticShape = {
  activeHighWater: CountSchema,
  pendingHighWater: CountSchema,
  granted: CountSchema,
  rejected: CountSchema,
  observationsDropped: CountSchema,
  waitMs: DistributionSchema,
  holdMs: DistributionSchema
}
export const AdmissionSnapshotSchema = z
  .object({
    ...stateShape,
    ...diagnosticShape,
    pendingOwners: CountSchema,
    closed: z.boolean()
  })
  .strict()
export const AdmissionObservationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('queued'), ...correlationShape, ...stateShape }).strict(),
  z
    .object({
      type: z.literal('granted'),
      ...correlationShape,
      ...stateShape,
      waitMs: DurationSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('released'),
      ...correlationShape,
      active: CountSchema,
      pending: CountSchema,
      holdMs: DurationSchema.optional(),
      reason: z.enum(['permit_released', 'lease_suspended', 'lease_released'])
    })
    .strict(),
  z
    .object({
      type: z.literal('rejected'),
      ...correlationShape,
      ...stateShape,
      waitMs: DurationSchema.optional(),
      reason: z.enum(['queue_full', 'aborted', 'closed'])
    })
    .strict(),
  z.object({ type: z.literal('closed'), ...stateShape, ...diagnosticShape }).strict()
])
