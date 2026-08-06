import { z } from 'zod'
import {
  EntityIdSchema,
  SessionStatusSchema,
  TimestampMsSchema,
  defineEventContract
} from '../common'
import { PublicRunSnapshotSchema, RunEventCursorSchema, RunIdSchema } from '../routes/runs.routes'

export const RunEventRecoveryReasonSchema = z.enum([
  'cursor_missing',
  'cursor_expired',
  'cursor_ahead',
  'server_restarted'
])

export const runsCreatedEvent = defineEventContract({
  name: 'runs.created',
  payload: z
    .object({
      runId: RunIdSchema,
      sessionId: EntityIdSchema,
      status: SessionStatusSchema,
      createdAt: TimestampMsSchema
    })
    .strict()
})

export const runsTurnAcceptedEvent = defineEventContract({
  name: 'runs.turn.accepted',
  payload: z
    .object({
      runId: RunIdSchema,
      sessionId: EntityIdSchema,
      requestId: EntityIdSchema.nullable(),
      messageId: EntityIdSchema.nullable(),
      acceptedAt: TimestampMsSchema
    })
    .strict()
})

export const runsTurnFailedEvent = defineEventContract({
  name: 'runs.turn.failed',
  payload: z
    .object({
      runId: RunIdSchema,
      sessionId: EntityIdSchema,
      failedAt: TimestampMsSchema,
      error: z.string().min(1).max(4096)
    })
    .strict()
})

export const runsCancelRequestedEvent = defineEventContract({
  name: 'runs.cancel.requested',
  payload: z
    .object({
      runId: RunIdSchema,
      sessionId: EntityIdSchema,
      requestedAt: TimestampMsSchema
    })
    .strict()
})

export const runsSnapshotEvent = defineEventContract({
  name: 'runs.snapshot',
  payload: z
    .object({
      cursor: RunEventCursorSchema,
      recoveryReason: RunEventRecoveryReasonSchema,
      run: PublicRunSnapshotSchema
    })
    .strict()
})

export const SESSION_RUN_STREAM_EVENT_NAMES = [
  'chat.stream.updated',
  'chat.stream.completed',
  'chat.stream.failed',
  'chat.plan.updated',
  'sessions.status.changed',
  'sessions.compaction.changed',
  'sessions.acp.modes.ready',
  'sessions.acp.commands.ready',
  'sessions.acp.configOptions.ready'
] as const

export const RUN_STREAM_EVENT_NAMES = [
  runsCreatedEvent.name,
  runsTurnAcceptedEvent.name,
  runsTurnFailedEvent.name,
  runsCancelRequestedEvent.name,
  runsSnapshotEvent.name,
  ...SESSION_RUN_STREAM_EVENT_NAMES
] as const

export const RunStreamEventNameSchema = z.enum(RUN_STREAM_EVENT_NAMES)
