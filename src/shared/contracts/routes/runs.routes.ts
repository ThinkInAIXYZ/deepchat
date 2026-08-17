import { z } from 'zod'
import {
  EntityIdSchema,
  MessagePageCursorSchema,
  SessionStatusSchema,
  TimestampMsSchema,
  defineRouteContract
} from '../common'
import { LocalControlEventCursorSchema } from '../localControl'

export const RUN_PROMPT_MAX_CHARACTERS = 256 * 1024
export const RUN_SYSTEM_PROMPT_MAX_CHARACTERS = 256 * 1024
export const RUN_MESSAGE_MAX_TEXT_BYTES = 128 * 1024
export const RUN_MAX_MESSAGE_PAGE_SIZE = 100

export const RunIdSchema = EntityIdSchema.max(128)
export const RunEventCursorSchema = LocalControlEventCursorSchema
export const PublicRunPhaseSchema = z.enum(['running', 'awaiting_interaction', 'terminal'])

const BoundedIdentifierSchema = z.string().trim().min(1).max(256)
const PublicRunMessageTextSchema = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= RUN_MESSAGE_MAX_TEXT_BYTES, {
    message: 'Run message text exceeds its UTF-8 byte limit'
  })
const UniqueIdentifierListSchema = z
  .array(BoundedIdentifierSchema)
  .max(128)
  .superRefine((values, context) => {
    const seen = new Set<string>()
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({ code: 'custom', message: `Duplicate value: ${value}`, path: [index] })
      }
      seen.add(value)
    })
  })

export const PublicRunMessageSchema = z
  .object({
    id: EntityIdSchema,
    role: z.enum(['user', 'assistant']),
    status: z.enum(['pending', 'sent', 'error']),
    text: PublicRunMessageTextSchema,
    textTruncated: z.boolean(),
    createdAt: TimestampMsSchema,
    updatedAt: TimestampMsSchema
  })
  .strict()

export const PublicRunSnapshotSchema = z
  .object({
    runId: RunIdSchema,
    sessionId: EntityIdSchema,
    agentId: EntityIdSchema,
    title: z.string(),
    status: SessionStatusSchema,
    phase: PublicRunPhaseSchema,
    providerId: z.string(),
    modelId: z.string(),
    createdAt: TimestampMsSchema,
    updatedAt: TimestampMsSchema,
    messages: z.array(PublicRunMessageSchema).max(RUN_MAX_MESSAGE_PAGE_SIZE),
    nextCursor: MessagePageCursorSchema.nullable(),
    hasMore: z.boolean()
  })
  .strict()

export const sessionsRunDetachedRoute = defineRouteContract({
  name: 'sessions.runDetached',
  input: z
    .object({
      prompt: z
        .string()
        .min(1)
        .max(RUN_PROMPT_MAX_CHARACTERS)
        .refine((value) => value.trim().length > 0, { message: 'Prompt must not be blank' }),
      agentId: BoundedIdentifierSchema.optional(),
      title: z.string().trim().min(1).max(512).optional(),
      projectDir: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .refine((value) => !value.includes('\0'), { message: 'Project directory contains NUL' })
        .optional(),
      providerId: BoundedIdentifierSchema.optional(),
      modelId: BoundedIdentifierSchema.optional(),
      systemPrompt: z.string().max(RUN_SYSTEM_PROMPT_MAX_CHARACTERS).optional(),
      activeSkills: UniqueIdentifierListSchema.optional(),
      disabledAgentTools: UniqueIdentifierListSchema.optional(),
      maxTurns: z.number().int().min(1).max(100).optional()
    })
    .strict(),
  output: z
    .object({
      runId: RunIdSchema,
      sessionId: EntityIdSchema,
      status: SessionStatusSchema,
      requestId: EntityIdSchema.nullable(),
      messageId: EntityIdSchema.nullable(),
      createdAt: TimestampMsSchema
    })
    .strict()
})

export const runsGetRoute = defineRouteContract({
  name: 'runs.get',
  input: z
    .object({
      runId: RunIdSchema,
      cursor: MessagePageCursorSchema.nullable().optional(),
      limit: z.number().int().positive().max(RUN_MAX_MESSAGE_PAGE_SIZE).optional()
    })
    .strict(),
  output: PublicRunSnapshotSchema
})

export const runsCancelRoute = defineRouteContract({
  name: 'runs.cancel',
  input: z.object({ runId: RunIdSchema }).strict(),
  output: z
    .object({
      runId: RunIdSchema,
      cancelRequested: z.boolean(),
      status: SessionStatusSchema
    })
    .strict()
})

export const eventsSubscribeRoute = defineRouteContract({
  name: 'events.subscribe',
  input: z
    .object({
      runId: RunIdSchema,
      cursor: RunEventCursorSchema.optional(),
      messageLimit: z.number().int().positive().max(RUN_MAX_MESSAGE_PAGE_SIZE).optional()
    })
    .strict(),
  output: z
    .object({
      runId: RunIdSchema,
      lastCursor: RunEventCursorSchema
    })
    .strict()
})

export type PublicRunMessage = z.infer<typeof PublicRunMessageSchema>
export type PublicRunPhase = z.infer<typeof PublicRunPhaseSchema>
export type PublicRunSnapshot = z.infer<typeof PublicRunSnapshotSchema>
export type RunDetachedInput = z.infer<typeof sessionsRunDetachedRoute.input>
export type RunDetachedOutput = z.infer<typeof sessionsRunDetachedRoute.output>
export type RunGetInput = z.infer<typeof runsGetRoute.input>
export type RunCancelInput = z.infer<typeof runsCancelRoute.input>
export type EventsSubscribeInput = z.infer<typeof eventsSubscribeRoute.input>
