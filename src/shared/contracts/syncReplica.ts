import { z } from 'zod'

export const SYNC_REPLICA_PREFIX = '/sync/v2'
export const SYNC_QUIET_MS = 15_000
export const SYNC_MIN_INTERVAL_MS = 60_000
export const SYNC_MAX_WAIT_MS = 120_000
export const SYNC_PART_BYTES = 16 * 1024 * 1024
export const SYNC_MAX_BATCH_BYTES = 32 * 1024 * 1024
export const SYNC_TARGET_BATCH_BYTES = 8 * 1024 * 1024
export const SYNC_MAX_UNITS = 128

const Integer = z.number().int().nonnegative().safe()
const Identity = z.string().min(1).max(512)
export const SyncRowSchema = z.record(
  z.string().max(100),
  z.union([z.string(), z.number().finite(), z.null()])
)
export type SyncRow = z.infer<typeof SyncRowSchema>
export const SyncUnitSchema = z
  .object({
    kind: Identity,
    id: Identity,
    modifiedAt: Integer,
    origin: Identity,
    revision: Integer,
    deleted: z.boolean(),
    tables: z.record(z.string().max(100), z.array(SyncRowSchema))
  })
  .strict()
export type SyncUnit = z.infer<typeof SyncUnitSchema>
export const SyncBatchSchema = z
  .object({
    protocol: z.literal(2),
    replicaId: Identity,
    after: Integer,
    through: Integer,
    units: z.array(SyncUnitSchema).max(SYNC_MAX_UNITS)
  })
  .strict()
export type SyncBatch = z.infer<typeof SyncBatchSchema>
export const SyncReplicaInfoSchema = z.object({
  protocol: z.literal(2),
  hostId: Identity,
  replicaId: Identity,
  revision: Integer,
  writable: z.boolean()
})
export const SyncBatchManifestSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  size: Integer.max(SYNC_MAX_BATCH_BYTES),
  parts: Integer.max(Math.ceil(SYNC_MAX_BATCH_BYTES / SYNC_PART_BYTES)),
  through: Integer,
  replicaId: Identity
})
export type SyncBatchManifest = z.infer<typeof SyncBatchManifestSchema>
export const SyncAutomaticStatusSchema = z.object({
  enabled: z.boolean(),
  phase: z.enum(['off', 'idle', 'waiting', 'syncing', 'busy', 'offline', 'failed']),
  lastSuccessAt: Integer.nullable(),
  error: z.string().nullable()
})
export type SyncAutomaticStatus = z.infer<typeof SyncAutomaticStatusSchema>
