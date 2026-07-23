import { z } from 'zod'
import { defineRouteContract } from '../common'

export const OcrBackendSchema = z.enum(['auto', 'cpu'])
export const OcrRecognitionStrategySchema = z.enum(['bounded-960', 'tiled-v1'])
export const OcrRuntimeUnavailableReasonSchema = z.enum([
  'asset_identity_mismatch',
  'assets_missing',
  'runtime_manifest_invalid',
  'service_closed',
  'unsupported_platform'
])

const OcrAvailabilitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    lightOcrVersion: z.string(),
    bundleId: z.string()
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: OcrRuntimeUnavailableReasonSchema,
    lightOcrVersion: z.string(),
    bundleId: z.string()
  })
])

const OcrEngineStageSchema = z.object({
  providerChain: z.array(z.string()),
  precision: z.string()
})

const OcrEngineSchema = z.object({
  coreVersion: z.string(),
  modelBundleId: z.string(),
  requestedBackend: OcrBackendSchema,
  strategy: OcrRecognitionStrategySchema,
  detection: OcrEngineStageSchema,
  recognition: OcrEngineStageSchema
})

const OcrProcessSchema = z.object({
  state: z.enum(['idle', 'starting', 'ready', 'busy', 'stopping', 'closed']),
  nodeVersion: z.string().nullable(),
  queuedRequests: z.number().int().nonnegative(),
  pendingInputBytes: z.number().int().nonnegative(),
  engine: OcrEngineSchema.nullable()
})

const OcrCacheSchema = z.object({
  mode: z.enum(['memory', 'persistent']),
  persistenceUnavailableReason: z.enum(['database_error', 'safe_storage_unavailable']).optional(),
  entryCount: z.number().int().nonnegative(),
  logicalBytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive()
})

export const OcrRuntimeStatusSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  availability: OcrAvailabilitySchema,
  process: OcrProcessSchema.nullable(),
  cache: OcrCacheSchema.nullable()
})

export const ocrGetRuntimeStatusRoute = defineRouteContract({
  name: 'ocr.getRuntimeStatus',
  input: z.object({}).default({}),
  output: OcrRuntimeStatusSchema
})

export const ocrClearCacheRoute = defineRouteContract({
  name: 'ocr.clearCache',
  input: z.object({}).default({}),
  output: z.object({
    cache: OcrCacheSchema
  })
})

export type OcrRuntimeStatus = z.infer<typeof OcrRuntimeStatusSchema>
