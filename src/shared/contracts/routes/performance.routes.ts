import { z } from 'zod'
import { defineRouteContract } from '../common'

const MAX_RENDERER_PERFORMANCE_ELAPSED_MS = 24 * 60 * 60 * 1000
const MAX_RENDERER_PERFORMANCE_RUN_ID_LENGTH = 160

export const RendererPerformanceScopeSchema = z.enum(['startup', 'workload', 'chat-session'])

export const RendererPerformancePhaseSchema = z.enum([
  'shell-mounted',
  'app-stores-ready',
  'bootstrap-ready',
  'bootstrap-fallback',
  'route-ready',
  'interactive',
  'deferred-settled',
  'selected',
  'preparation-started',
  'cache-committed',
  'messages-prepared',
  'messages-committed',
  'first-message-paint',
  'input-ready',
  'secondary-state-ready'
])

export const RendererPerformanceOutcomeSchema = z.enum(['completed', 'failed', 'cancelled'])

export const RendererStartupWorkloadTaskIdSchema = z.enum([
  'main.bootstrap',
  'main.session.firstPage',
  'main.provider.warmup'
])

export const RendererStartupWorkloadTaskStateSchema = z.enum(['completed', 'failed', 'cancelled'])

/**
 * The renderer never sends user content, persistent entity IDs, paths, errors, or arbitrary metadata
 * through this contract. Keep this allowlist narrow because records are persisted to the local log.
 */
export const RendererPerformanceRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal('chat-main'),
    scope: RendererPerformanceScopeSchema,
    phase: RendererPerformancePhaseSchema,
    outcome: RendererPerformanceOutcomeSchema.default('completed'),
    elapsedMs: z.number().finite().min(0).max(MAX_RENDERER_PERFORMANCE_ELAPSED_MS),
    startupRunId: z.string().min(1).max(MAX_RENDERER_PERFORMANCE_RUN_ID_LENGTH).optional(),
    fallback: z.boolean().optional(),
    sessionEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    workloadTaskId: RendererStartupWorkloadTaskIdSchema.optional(),
    workloadTaskState: RendererStartupWorkloadTaskStateSchema.optional()
  })
  .strict()

export type RendererPerformanceRecord = z.output<typeof RendererPerformanceRecordSchema>
export type RendererPerformancePhase = z.output<typeof RendererPerformancePhaseSchema>
export type RendererStartupWorkloadTaskId = z.output<typeof RendererStartupWorkloadTaskIdSchema>
export type RendererStartupWorkloadTaskState = z.output<
  typeof RendererStartupWorkloadTaskStateSchema
>

export const performanceRecordRendererRoute = defineRouteContract({
  name: 'performance.recordRenderer',
  input: RendererPerformanceRecordSchema,
  output: z.object({
    accepted: z.boolean()
  })
})
