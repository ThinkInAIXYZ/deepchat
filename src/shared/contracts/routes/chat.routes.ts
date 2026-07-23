import { z } from 'zod'
import {
  AttachmentPreparationSummarySchema,
  EntityIdSchema,
  SubmissionIdSchema,
  SendMessageInputSchema,
  ToolInteractionResponseSchema,
  ToolInteractionResultSchema,
  defineRouteContract
} from '../common'

export const chatSendMessageRoute = defineRouteContract({
  name: 'chat.sendMessage',
  input: z.object({
    sessionId: EntityIdSchema,
    content: z.union([z.string(), SendMessageInputSchema]),
    submissionId: SubmissionIdSchema.optional()
  }),
  output: z.object({
    accepted: z.boolean(),
    requestId: EntityIdSchema.nullable(),
    messageId: EntityIdSchema.nullable(),
    attachmentPreparation: AttachmentPreparationSummarySchema.optional()
  })
})

export const chatSteerActiveTurnRoute = defineRouteContract({
  name: 'chat.steerActiveTurn',
  input: z.object({
    sessionId: EntityIdSchema,
    content: z.union([z.string(), SendMessageInputSchema]),
    submissionId: SubmissionIdSchema.optional()
  }),
  output: z.object({
    accepted: z.boolean(),
    attachmentPreparation: AttachmentPreparationSummarySchema.optional()
  })
})

export const chatCancelSubmissionRoute = defineRouteContract({
  name: 'chat.cancelSubmission',
  input: z.object({
    submissionId: SubmissionIdSchema
  }),
  output: z.object({
    cancelled: z.boolean()
  })
})

export const chatStopStreamRoute = defineRouteContract({
  name: 'chat.stopStream',
  input: z
    .object({
      sessionId: EntityIdSchema.optional(),
      requestId: EntityIdSchema.optional()
    })
    .refine((value) => Boolean(value.sessionId || value.requestId), {
      message: 'sessionId or requestId is required'
    }),
  output: z.object({
    stopped: z.boolean()
  })
})

export const chatRespondToolInteractionRoute = defineRouteContract({
  name: 'chat.respondToolInteraction',
  input: z.object({
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    toolCallId: EntityIdSchema,
    response: ToolInteractionResponseSchema
  }),
  output: z
    .object({
      accepted: z.literal(true)
    })
    .extend(ToolInteractionResultSchema.shape)
})
