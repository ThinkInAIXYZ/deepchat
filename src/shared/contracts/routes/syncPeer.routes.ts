import { z } from 'zod'
import { SyncAutomaticStatusSchema } from '../syncReplica'
import { defineRouteContract } from '../common'

export const SyncPeerStatusSchema = z.object({
  automatic: SyncAutomaticStatusSchema.optional(),
  paired: z.boolean(),
  canWrite: z.boolean(),
  hostUrl: z.string(),
  hostId: z.string(),
  deviceName: z.string(),
  phase: z.enum([
    'idle',
    'pairing',
    'preparing',
    'downloading',
    'verifying',
    'importing',
    'completed',
    'cancelled',
    'failed'
  ]),
  received: z.number().nonnegative(),
  total: z.number().nonnegative(),
  lastSuccessAt: z.number().nullable(),
  error: z.string().nullable()
})
export type SyncPeerStatus = z.infer<typeof SyncPeerStatusSchema>

export const syncPeerGetStatusRoute = defineRouteContract({
  name: 'syncPeer.getStatus',
  input: z.object({}).default({}),
  output: SyncPeerStatusSchema
})
export const syncPeerPairRoute = defineRouteContract({
  name: 'syncPeer.pair',
  input: z.object({
    hostUrl: z.string().min(1).max(2048),
    hostId: z.string().min(1).max(256),
    code: z.string().min(1).max(256),
    deviceName: z.string().trim().min(1).max(120),
    bidirectional: z.boolean().optional()
  }),
  output: SyncPeerStatusSchema
})
export const syncPeerPullRoute = defineRouteContract({
  name: 'syncPeer.pull',
  input: z.object({
    mode: z.enum(['increment', 'overwrite']),
    confirmOverwrite: z.boolean().optional()
  }),
  output: SyncPeerStatusSchema
})
export const syncPeerCancelRoute = defineRouteContract({
  name: 'syncPeer.cancel',
  input: z.object({}).default({}),
  output: SyncPeerStatusSchema
})
export const syncPeerForgetRoute = defineRouteContract({
  name: 'syncPeer.forget',
  input: z.object({}).default({}),
  output: SyncPeerStatusSchema
})

export const syncPeerSetAutomaticRoute = defineRouteContract({
  name: 'syncPeer.setAutomatic',
  input: z.object({ enabled: z.boolean() }),
  output: SyncPeerStatusSchema
})
export const syncPeerSyncNowRoute = defineRouteContract({
  name: 'syncPeer.syncNow',
  input: z.object({}).default({}),
  output: SyncPeerStatusSchema
})
