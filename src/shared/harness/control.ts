import { z } from 'zod'

export const HARNESS_CONTROL_METADATA_BYTES = 16 * 1024 * 1024
export const HARNESS_CONTROL_PENDING = 1024

const id = z.string().min(1)
const status = z.enum(['idle', 'generating', 'error'])
const scope = { scopeId: id }
const operation = { ...scope, operationId: id }
const run = { ...scope, runId: id }

export const HarnessControlOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('operation'), id }).strict(),
  z.object({ kind: z.literal('run'), id }).strict(),
  z.object({ kind: z.literal('orphan') }).strict()
])
export type HarnessControlOwner = z.infer<typeof HarnessControlOwnerSchema>

const interactionOrigin = z.enum([
  'pre-check-permission',
  'question',
  'post-call-permission',
  'skill-draft-confirmation',
  'acp-permission'
])
export const HarnessPendingInteractionSchema = z
  .object({
    messageId: id,
    toolCallId: id,
    origin: interactionOrigin,
    order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
export type HarnessPendingInteraction = z.infer<typeof HarnessPendingInteractionSchema>

export const HarnessToolBatchSchema = z
  .object({
    id,
    callOrder: z.array(id),
    invokedCallIds: z.array(id),
    committedResultCallIds: z.array(id),
    pendingInteractionCallIds: z.array(id)
  })
  .strict()
export type HarnessToolBatch = z.infer<typeof HarnessToolBatchSchema>

export const HarnessInteractionUpdateSchema = z
  .object({
    interactions: z.array(HarnessPendingInteractionSchema),
    batch: HarnessToolBatchSchema.nullable().optional(),
    reconcile: z.boolean().optional()
  })
  .strict()
export type HarnessInteractionUpdate = z.infer<typeof HarnessInteractionUpdateSchema>

const inputSource = z.enum(['send', 'queue', 'steer'])
const inputWakeReason = z.enum(['completed', 'enqueue', 'manual'])
const inputDisposition = z.enum([
  'consume',
  'block',
  'release-for-mutation',
  'release-before-user-fact',
  'release-after-rollback'
])
const claimEffectAction = z.union([z.enum(['user-fact', 'rollback']), inputDisposition])
const inputEffectOutcome = z.enum(['applied', 'rejected', 'unknown'])
export const HarnessInputSnapshotSchema = z
  .object({
    queue: z.array(
      z.object({ id, state: z.enum(['pending', 'blocked', 'retry_required']) }).strict()
    ),
    steerHead: z
      .object({ id, state: z.enum(['pending', 'blocked']) })
      .strict()
      .nullable(),
    hasClaimed: z.boolean(),
    hasBlocking: z.boolean(),
    awaitingFollowUp: z.boolean()
  })
  .strict()
export type HarnessInputSnapshot = z.infer<typeof HarnessInputSnapshotSchema>

export const HarnessBeginInputResultSchema = z
  .object({
    action: z.enum(['pending', 'claim', 'prepare', 'steer', 'busy', 'blocked']),
    claimId: id.optional(),
    effectId: id.optional(),
    inputId: id.optional(),
    source: inputSource.optional(),
    drainLeaseId: id.optional(),
    consumeBeforeProviderStream: z.boolean(),
    mergeItemId: id.optional(),
    wakeReason: z.literal('enqueue').optional()
  })
  .strict()
export type HarnessBeginInputResult = z.infer<typeof HarnessBeginInputResultSchema>

export const HarnessQueryInputResultSchema = z
  .object({
    canDrain: z.boolean(),
    hasRestartHeld: z.boolean(),
    onlyRestartHeld: z.boolean()
  })
  .strict()
export type HarnessQueryInputResult = z.infer<typeof HarnessQueryInputResultSchema>

export const HarnessClaimEffectGrantSchema = z
  .object({ effectId: id, action: claimEffectAction })
  .strict()
export type HarnessClaimEffectGrant = z.infer<typeof HarnessClaimEffectGrantSchema>
export const HarnessEndInputResultSchema = z
  .object({ released: z.boolean(), nextWake: inputWakeReason.nullable() })
  .strict()

const inputClaim = z
  .object({
    id,
    inputId: id.nullable(),
    source: inputSource,
    disposition: inputDisposition.nullable(),
    outcome: inputEffectOutcome.nullable(),
    consumeBeforeProviderStream: z.boolean(),
    effect: z
      .object({
        id,
        action: z.union([z.literal('claim'), claimEffectAction]),
        outcome: inputEffectOutcome.nullable()
      })
      .strict()
      .nullable()
  })
  .strict()

export const HarnessControlLeaseTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interaction'), messageId: id, toolCallId: id }).strict(),
  z.object({ kind: z.literal('resume'), messageId: id }).strict(),
  z
    .object({
      kind: z.literal('deferred'),
      messageId: id,
      toolCallId: id,
      parentLeaseId: id,
      owner: HarnessControlOwnerSchema
    })
    .strict()
])
export type HarnessControlLeaseTarget = z.infer<typeof HarnessControlLeaseTargetSchema>
export interface HarnessControlLease {
  readonly id: string
  readonly target: HarnessControlLeaseTarget
}
const acceptanceLane = z.enum(['send', 'steer'])
export type HarnessAcceptanceLane = z.infer<typeof acceptanceLane>

export const HarnessPermissionDecisionSchema = z.enum(['callback', 'direct', 'conflict', 'spent'])
const permission = { requestId: id, messageId: id, toolCallId: z.string() }

export const HarnessControlCommandSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('inputRecovery'),
      sessions: z.array(z.object({ sessionId: id, heldInputIds: z.array(id) }).strict())
    })
    .strict(),
  z
    .object({
      method: z.literal('queryInput'),
      ...scope,
      snapshot: HarnessInputSnapshotSchema,
      reason: inputWakeReason.optional()
    })
    .strict(),
  z
    .object({
      method: z.literal('beginInput'),
      ...scope,
      requestId: id,
      intent: z.enum(['enqueue', 'drain', 'prepare', 'steer']),
      source: inputSource,
      reason: inputWakeReason.optional(),
      itemId: id.optional(),
      snapshot: HarnessInputSnapshotSchema
    })
    .strict(),
  z
    .object({
      method: z.literal('ackInputEffect'),
      ...scope,
      claimId: id.optional(),
      effectId: id,
      outcome: inputEffectOutcome,
      inputId: id.optional(),
      messageId: id.optional()
    })
    .strict(),
  z
    .object({
      method: z.literal('prepareClaimEffect'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      claimId: id,
      effectId: id,
      action: claimEffectAction
    })
    .strict(),
  z
    .object({
      method: z.literal('inputHold'),
      ...scope,
      action: z.enum(['release-item', 'resume']),
      itemId: id.optional(),
      queueIds: z.array(id).optional(),
      headId: id.optional()
    })
    .strict(),
  z.object({ method: z.literal('endInput'), ...scope, drainLeaseId: id }).strict(),
  z.object({ method: z.literal('open'), sessionId: id, ...scope }).strict(),
  z.object({ method: z.literal('prepareOperation'), ...operation }).strict(),
  z.object({ method: z.literal('prepareRun'), ...operation, runId: id, messageId: id }).strict(),
  z
    .object({ method: z.literal('commit'), ...scope, transitionId: id, aborted: z.boolean() })
    .strict(),
  z.object({ method: z.literal('clearOperation'), ...operation, runId: id.nullable() }).strict(),
  z.object({ method: z.literal('clearRun'), ...run }).strict(),
  z.object({ method: z.literal('abort'), ...scope }).strict(),
  z.object({ method: z.literal('operationAborted'), ...operation }).strict(),
  z
    .object({
      method: z.literal('status'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      status,
      interactions: HarnessInteractionUpdateSchema.optional()
    })
    .strict(),
  z
    .object({
      method: z.literal('updateInteractions'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      update: HarnessInteractionUpdateSchema
    })
    .strict(),
  z
    .object({
      method: z.literal('advanceBatch'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      invokedCallId: id.optional(),
      committedResultCallId: id.optional()
    })
    .strict(),
  z
    .object({
      method: z.literal('interactionOrigin'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      messageId: id,
      toolCallId: id,
      origin: interactionOrigin
    })
    .strict(),
  z
    .object({
      method: z.literal('checkInteraction'),
      ...scope,
      owner: HarnessControlOwnerSchema,
      messageId: id,
      toolCallId: id,
      leaseId: id
    })
    .strict(),
  z.object({ method: z.literal('ready'), ...run }).strict(),
  z.object({ method: z.literal('clearReady'), ...scope }).strict(),
  z.object({ method: z.literal('abortDeferred'), ...scope }).strict(),
  z
    .object({
      method: z.literal('registerPermission'),
      ...scope,
      ...permission,
      permissionId: id,
      runId: id
    })
    .strict(),
  z
    .object({
      method: z.literal('takePermission'),
      ...scope,
      ...permission,
      permissionId: id.nullable(),
      runId: id.nullable(),
      leaseId: id,
      granted: z.boolean(),
      resolutionId: id
    })
    .strict(),
  z
    .object({
      method: z.literal('acquireLease'),
      ...scope,
      leaseId: id,
      target: HarnessControlLeaseTargetSchema
    })
    .strict(),
  z
    .object({
      method: z.literal('releaseLease'),
      ...scope,
      leaseId: id,
      target: HarnessControlLeaseTargetSchema
    })
    .strict(),
  z
    .object({
      method: z.literal('parkInteraction'),
      ...scope,
      leaseId: id,
      messageId: id,
      toolCallId: id
    })
    .strict(),
  z
    .object({ method: z.literal('clearSession'), sessionId: id, originScopeId: id.nullable() })
    .strict(),
  z
    .object({ method: z.literal('queueAcceptance'), ...scope, leaseId: id, lane: acceptanceLane })
    .strict(),
  z
    .object({ method: z.literal('releaseAcceptance'), ...scope, leaseId: id, lane: acceptanceLane })
    .strict(),
  z.object({ method: z.literal('retire'), ...scope }).strict(),
  z.object({ method: z.literal('release'), ...scope }).strict()
])
export type HarnessControlCommand = z.infer<typeof HarnessControlCommandSchema>

const scopeSnapshot = z
  .object({
    id,
    sessionId: id,
    current: z.boolean(),
    status,
    operation: z.object({ id, aborted: z.boolean() }).strict().nullable(),
    run: z.object({ id, messageId: id, operationId: id }).strict().nullable(),
    firstTurnReady: z.boolean(),
    drainLeaseId: id.nullable(),
    permissions: z.array(z.object({ requestId: id, id }).strict()),
    deferred: z.array(z.object({ toolCallId: id, id }).strict()),
    interactions: z.array(HarnessPendingInteractionSchema),
    batch: HarnessToolBatchSchema.nullable(),
    input: z
      .object({
        activeSteerId: id.nullable(),
        activeClaimId: id.nullable(),
        claims: z.array(inputClaim),
        restartHeldIds: z.array(id),
        manuallyResumedIds: z.array(id),
        wakeReason: inputWakeReason.nullable()
      })
      .strict()
  })
  .strict()
export type HarnessControlScope = z.infer<typeof scopeSnapshot>

export const HarnessControlReceiptSchema = z
  .object({
    protocol: z.literal(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    outcome: z.enum(['accepted', 'stale', 'cancelled']),
    scope: scopeSnapshot.nullable(),
    result: z.unknown(),
    fences: z.array(
      z.object({ kind: z.enum(['operation', 'run', 'scope', 'permission']), id }).strict()
    ),
    grants: z.array(z.object({ scopeId: id, leaseId: id }).strict())
  })
  .strict()
export type HarnessControlReceipt = z.infer<typeof HarnessControlReceiptSchema>

export interface HarnessControlPort {
  readonly closed: boolean
  send(
    command: HarnessControlCommand,
    receive?: (receipt: HarnessControlReceipt) => void
  ): Promise<HarnessControlReceipt>
  transition(
    command: Extract<HarnessControlCommand, { method: 'prepareOperation' | 'prepareRun' }>,
    receive: (receipt: HarnessControlReceipt) => boolean
  ): Promise<HarnessControlReceipt>
  onClose(listener: () => void): () => void
  onGrant(scopeId: string, listener: (leaseId: string) => void): () => void
}
