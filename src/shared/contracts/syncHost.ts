import { z } from 'zod'

/**
 * Wire contract for the Cloudflare Tunnel host sync endpoint.
 *
 * The host serves these routes on a loopback listener that a user-operated `cloudflared`
 * tunnel forwards to. `handshake` is the only unauthenticated route; every other route
 * requires a per-device bearer token issued through pairing.
 */
export const SYNC_HOST_PROTOCOL_VERSION = 1 as const
export const SYNC_HOST_PROTOCOL_NAME = 'sync/v1' as const

export const SYNC_HOST_PATH_PREFIX = '/sync/v1'
export const SYNC_HOST_HANDSHAKE_PATH = `${SYNC_HOST_PATH_PREFIX}/handshake`
export const SYNC_HOST_PAIR_PATH = `${SYNC_HOST_PATH_PREFIX}/pair`
export const SYNC_HOST_STATUS_PATH = `${SYNC_HOST_PATH_PREFIX}/status`
export const SYNC_HOST_SNAPSHOT_PATH = `${SYNC_HOST_PATH_PREFIX}/snapshot`
export const SYNC_HOST_PREPARE_PATH = `${SYNC_HOST_PATH_PREFIX}/prepare`
export const SYNC_HOST_PUSH_PATH = `${SYNC_HOST_PATH_PREFIX}/push`
export const SYNC_HOST_EVENTS_PATH = `${SYNC_HOST_PATH_PREFIX}/events`

export const SYNC_HOST_MAX_HEADER_BYTES = 8 * 1024
/**
 * Connection ceiling. It is a memory bound, not a quota: when it is reached the endpoint evicts the
 * oldest connection that is not streaming a response rather than refusing the newcomer, so a caller
 * holding stalled connections cannot deny the legitimate device (or the user's own pairing).
 */
export const SYNC_HOST_MAX_CONNECTIONS = 32
/**
 * Budget for *receiving* a request (headers plus body). It does not bound how long a response may
 * stream, so a large snapshot download is unaffected, while a stalled request is discarded long
 * before it can hold a connection slot indefinitely.
 */
export const SYNC_HOST_REQUEST_RECEIVE_TIMEOUT_MS = 60_000
export const SYNC_HOST_PAIR_BODY_MAX_BYTES = 4 * 1024
export const SYNC_HOST_RATE_LIMIT_WINDOW_MS = 60_000
export const SYNC_HOST_RATE_LIMIT_REQUESTS_PER_WINDOW = 120
export const SYNC_HOST_RATE_LIMIT_MAX_KEYS = 1024
export const SYNC_HOST_PAIRING_CODE_TTL_MS = 5 * 60_000
/**
 * Per-source pairing failure budget. There is deliberately no global attempt cap and no
 * `attemptsRemaining` in the pairing payload: anyone who learns the tunnel hostname can call
 * `pair`, so a global counter would both hand them a denial of pairing and let them drive a
 * number the UI shows. Brute force is bounded per source against ~40 bits of code entropy.
 */
export const SYNC_HOST_PAIR_FAILURE_WINDOW_MS = 5 * 60_000
export const SYNC_HOST_PAIR_MAX_FAILURES_PER_WINDOW = 20
export const SYNC_HOST_PAIR_FAILURE_MAX_KEYS = 1024
export const SYNC_HOST_DEVICE_TOKEN_BYTES = 32
export const SYNC_HOST_DEVICE_NAME_MAX_LENGTH = 120
export const SYNC_HOST_MAX_PUSH_PART_BYTES = 32 * 1024 * 1024
export const SYNC_HOST_AUDIT_LIMIT = 500

/** User-visible failure codes surfaced to the renderer; copy is added with the Settings UI. */
export const SYNC_HOST_BIND_FAILED_ERROR = 'sync.tunnel.error.bindFailed'

export const SYNC_HOST_SNAPSHOT_ID_HEADER = 'x-deepchat-snapshot-id'
export const SYNC_HOST_SNAPSHOT_HASH_HEADER = 'x-deepchat-snapshot-sha256'
export const SYNC_HOST_DEVICE_HEADER = 'x-deepchat-device-id'

export const SyncHostCapabilitySchema = z.enum(['snapshot', 'range', 'prepare', 'push', 'events'])
export type SyncHostCapability = z.infer<typeof SyncHostCapabilitySchema>

export const SyncHostHandshakeSchema = z.object({
  protocol: z.literal(SYNC_HOST_PROTOCOL_NAME),
  protocolVersion: z.number().int().positive(),
  /** Stable opaque host identity, also carried by pairing payloads for out-of-band verification. */
  hostId: z.string(),
  appVersion: z.string(),
  capabilities: z.array(SyncHostCapabilitySchema),
  encryption: z.object({
    payload: z.literal('none'),
    transport: z.literal('tls')
  })
})
export type SyncHostHandshake = z.infer<typeof SyncHostHandshakeSchema>

export const SyncHostSnapshotInfoSchema = z.object({
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  /** `version` from the backup package manifest; null when the archive cannot be read. */
  backupFormatVersion: z.number().int().nonnegative().nullable(),
  /**
   * Whether the packaged database is encrypted. A slave cannot import an encrypted package without
   * the password, so this must be reported rather than discovered as a decrypt failure.
   */
  databaseEncrypted: z.boolean()
})
export type SyncHostSnapshotInfo = z.infer<typeof SyncHostSnapshotInfoSchema>

export const SyncHostStatusSchema = z.object({
  snapshot: SyncHostSnapshotInfoSchema.nullable(),
  serverTime: z.number().int().nonnegative(),
  preparing: z.boolean().default(false),
  preparationError: z.string().nullable().default(null)
})
export type SyncHostStatus = z.infer<typeof SyncHostStatusSchema>

export const SyncHostPairRequestSchema = z.object({
  code: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(SYNC_HOST_DEVICE_NAME_MAX_LENGTH)
})
export type SyncHostPairRequest = z.infer<typeof SyncHostPairRequestSchema>

export const SyncHostPairResponseSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  token: z.string()
})
export type SyncHostPairResponse = z.infer<typeof SyncHostPairResponseSchema>

/** Device view exposed to the renderer. Never contains token material or token hashes. */
export const SyncHostDeviceViewSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable(),
  lastSeenAt: z.number().int().nonnegative().nullable(),
  revoked: z.boolean()
})
export type SyncHostDeviceView = z.infer<typeof SyncHostDeviceViewSchema>

export const SyncHostAuditEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  bytes: z.number().int().nonnegative(),
  deviceId: z.string().nullable(),
  clientIp: z.string().nullable(),
  /**
   * Rejections from one anonymous source are coalesced into a single entry that counts the repeats,
   * so unauthenticated traffic cannot flush the audit ring by evicting everything else.
   */
  suppressed: z.number().int().nonnegative()
})
export type SyncHostAuditEntry = z.infer<typeof SyncHostAuditEntrySchema>
