import { z } from 'zod'
import {
  AssistantMessageBlockSchema,
  EntityIdSchema,
  TimestampMsSchema,
  defineEventContract
} from '../common'
import { agentPlanItemSchema, agentPlanTerminalReasonSchema } from '../../types/agent-plan'

export const chatStreamUpdatedEvent = defineEventContract({
  name: 'chat.stream.updated',
  payload: z.object({
    kind: z.literal('snapshot'),
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    updatedAt: TimestampMsSchema,
    blocks: z.array(AssistantMessageBlockSchema)
  })
})

export const chatStreamCompletedEvent = defineEventContract({
  name: 'chat.stream.completed',
  payload: z.object({
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    completedAt: TimestampMsSchema
  })
})

export const chatStreamFailedEvent = defineEventContract({
  name: 'chat.stream.failed',
  payload: z.object({
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    failedAt: TimestampMsSchema,
    error: z.string()
  })
})

export const chatPlanUpdatedEvent = defineEventContract({
  name: 'chat.plan.updated',
  payload: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    toolCallId: z.string().optional(),
    plan: z.array(agentPlanItemSchema),
    explanation: z.string().optional(),
    revision: z.number().int().positive(),
    updatedAt: z.string(),
    terminalReason: agentPlanTerminalReasonSchema.optional()
  })
})

// Lightweight per-session stream activity signal. When a stream event is routed
// only to renderers bound to the session, other windows still need to refresh
// their recent-session views (sidebar status badges); this event carries just
// the sessionId so the full block snapshot is not resent to them.
export const chatStreamActivityEvent = defineEventContract({
  name: 'chat.stream.activity',
  payload: z.object({
    sessionId: EntityIdSchema
  })
})
