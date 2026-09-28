import { z } from 'zod'
import {
  isLodySubagentEvent,
  LODY_EXTENSION_METHODS,
  type LodyExtensionCapabilities,
  type LodyExtensionNotificationMap,
  type LodyExtensionNotificationMethod
} from 'acp-extension-core'

const text = z.string().max(65_536)
const id = z.string().min(1).max(256)
const count = z.number().finite().nonnegative()
const v1 = z.object({ version: z.literal(1) })
const action = z.enum(['set', 'pause', 'resume', 'clear'])
const optionalCapability = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)
const capabilitiesSchema = z.object({
  subagentEvents: optionalCapability(v1),
  sessionTitle: optionalCapability(v1),
  usage: optionalCapability(v1),
  rateLimits: optionalCapability(v1.extend({ query: z.literal(true).optional() })),
  forkAtTurn: optionalCapability(v1),
  steering: optionalCapability(
    v1.extend({
      transport: z.enum(['request', 'prompt']),
      upstreamTurn: z.enum(['same', 'handoff']),
      configPolicy: z.enum(['active', 'apply'])
    })
  ),
  tasks: optionalCapability(
    v1.extend({
      background: z.literal(true).optional(),
      scheduled: z.literal(true).optional()
    })
  ),
  subagents: optionalCapability(
    v1.extend({
      lifecycle: z.literal(true),
      list: z.literal(true).optional(),
      cancel: z.literal(true).optional(),
      output: z.literal(true).optional()
    })
  ),
  goal: optionalCapability(
    v1.extend({
      actions: z.array(action).max(4),
      controlActions: z.array(action).max(4).optional(),
      promptActions: z.array(action).max(4).optional()
    })
  ),
  compaction: optionalCapability(v1),
  sessionHistory: optionalCapability(v1),
  worktreeProject: optionalCapability(v1)
})

export function readLodyCapabilities(meta: unknown): LodyExtensionCapabilities {
  const result = z.object({ lody: capabilitiesSchema }).safeParse(meta)
  return result.success ? result.data.lody : {}
}

export const acpModelUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadInputTokens: count,
  cacheCreationInputTokens: count.optional(),
  reasoningOutputTokens: count.optional(),
  webSearchRequests: count.optional(),
  costUSD: count.optional(),
  contextWindow: count.optional()
})
const modelUsage = z
  .record(id, acpModelUsageSchema)
  .refine((rows) => Object.keys(rows).length <= 128)
const usageSchema = z.object({
  sessionId: id,
  usage: acpModelUsageSchema,
  modelUsage: modelUsage.optional(),
  delta: z.object({ usage: acpModelUsageSchema, modelUsage }).optional(),
  _meta: z.object({ lody: z.object({ usageScopeId: id }).optional() }).optional()
})

export const acpRateLimitsSchema = z.object({
  rateLimits: z
    .array(
      z.object({
        limitId: id,
        scope: z.object({ providerId: id, accountId: id.optional(), modelId: id.optional() }),
        limitName: text.nullish(),
        planName: text.nullish(),
        windows: z
          .array(
            z.object({
              label: text.optional(),
              usedPercent: count.max(100),
              windowDurationSeconds: count.nullable(),
              resetsAtEpochSeconds: count.nullable()
            })
          )
          .max(64),
        wallet: z
          .object({
            balanceCents: z.number().finite(),
            totalCents: count,
            monthlyChargeLimitEnabled: z.boolean(),
            monthlyChargeLimitCents: count,
            monthlyUsedCents: count,
            currency: id
          })
          .nullish()
      })
    )
    .max(128),
  fetchedAtEpochSeconds: count.optional()
})

export const acpGoalSchema = z.object({
  objective: text,
  status: z.enum(['active', 'paused', 'blocked', 'limited', 'complete']),
  iterations: count.optional(),
  lastReason: text.nullish(),
  createdAtEpochSeconds: count.optional(),
  updatedAtEpochSeconds: count.optional(),
  tokenBudget: count.nullish(),
  tokensUsed: count.optional(),
  timeUsedSeconds: count.optional()
})

export const acpTaskSchema = v1.extend({
  taskId: id,
  kind: z.enum(['subagent', 'background', 'scheduled']),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  description: text.optional(),
  actor: text.optional(),
  parentTaskId: id.optional(),
  parentToolCallId: id.optional(),
  modelId: id.optional(),
  startedAtEpochSeconds: count.optional(),
  endedAtEpochSeconds: count.optional(),
  summary: text.optional(),
  error: text.optional(),
  lastToolName: text.optional(),
  usage: z
    .object({
      totalTokens: count.optional(),
      toolUses: count.optional(),
      durationMs: count.optional()
    })
    .optional(),
  skipTranscript: z.boolean().optional()
})

export const acpRemoteTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        taskId: id,
        description: text,
        status: z.enum(['running', 'completed', 'failed', 'timed_out', 'killed', 'lost']),
        agentId: id.optional(),
        subagentType: text.optional(),
        modelId: id.optional(),
        thinkingEffort: text.optional(),
        startedAtEpochSeconds: count,
        endedAtEpochSeconds: count.nullable(),
        stopReason: text.optional()
      })
    )
    .max(256)
})

const sessionMetaSchema = z.object({
  turnId: id.optional(),
  toolName: text.optional(),
  titleSource: z.enum(['explicit', 'generated', 'fallback', 'unset']).optional(),
  messagePhase: z.enum(['commentary', 'final_answer']).optional(),
  goal: acpGoalSchema.nullish(),
  task: acpTaskSchema.optional(),
  activity: v1
    .extend({
      kind: z.enum(['context_compaction', 'retry']),
      automatic: z.boolean().optional(),
      usedTokensBefore: count.optional(),
      usedTokensAfter: count.optional(),
      durationMs: count.optional(),
      failureReason: text.optional()
    })
    .optional(),
  notice: z
    .object({ level: z.enum(['info', 'warning', 'error']), message: text, source: text.optional() })
    .optional()
})

export function readLodySessionMeta(meta: unknown): z.infer<typeof sessionMetaSchema> {
  const parsed = z.object({ lody: sessionMetaSchema }).safeParse(meta)
  return parsed.success ? parsed.data.lody : {}
}

export type AcpExtensionNotification = {
  [M in LodyExtensionNotificationMethod]: { method: M; params: LodyExtensionNotificationMap[M] }
}[LodyExtensionNotificationMethod]

export function parseLodyNotification(
  method: LodyExtensionNotificationMethod,
  params: unknown
): AcpExtensionNotification | null {
  // Bound unknown producer data before storing it or invoking the Core guards.
  try {
    if (JSON.stringify(params).length > 1_048_576) return null
  } catch {
    return null
  }
  switch (method) {
    case LODY_EXTENSION_METHODS.sessionUsageUpdate: {
      const parsed = usageSchema.safeParse(params)
      return parsed.success ? { method, params: parsed.data } : null
    }
    case LODY_EXTENSION_METHODS.rateLimitsUpdate: {
      const parsed = acpRateLimitsSchema.safeParse(params)
      return parsed.success ? { method, params: parsed.data } : null
    }
    case LODY_EXTENSION_METHODS.sessionSteerApplied: {
      const parsed = z.object({ sessionId: id, steerId: id }).safeParse(params)
      return parsed.success ? { method, params: parsed.data } : null
    }
    case LODY_EXTENSION_METHODS.subagentEvent:
      return isLodySubagentEvent(params) &&
        [params.sessionId, params.runId].every((value) => value.length > 0 && value.length <= 256)
        ? { method, params }
        : null
  }
}
