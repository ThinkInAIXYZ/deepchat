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
