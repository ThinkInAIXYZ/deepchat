import { z } from 'zod'
import type { PendingSessionInputRecord } from '@shared/types/agent-interface'
import {
  EntityIdSchema,
  SessionCompactionStateSchema,
  SessionStatusSchema,
  defineEventContract
} from '../common'
import { AcpConfigStateSchema } from '../domainSchemas'

const PendingSessionInputRecordSchema = z.custom<PendingSessionInputRecord>()

const AcpSessionCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string()
    })
    .nullable()
    .optional()
})

const AcpSessionModeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string()
})

export const sessionsUpdatedEvent = defineEventContract({
  name: 'sessions.updated',
  payload: z.object({
    sessionIds: z.array(EntityIdSchema),
    reason: z.enum(['created', 'activated', 'deactivated', 'list-refreshed', 'updated', 'deleted']),
    activeSessionId: EntityIdSchema.nullable().optional(),
    webContentsId: z.number().int().optional()
  })
})

export const sessionsStatusChangedEvent = defineEventContract({
  name: 'sessions.status.changed',
  payload: z.object({
    sessionId: EntityIdSchema,
    status: SessionStatusSchema,
    version: z.number().int()
  })
})

export const sessionsCompactionChangedEvent = defineEventContract({
  name: 'sessions.compaction.changed',
  payload: SessionCompactionStateSchema.extend({
    sessionId: EntityIdSchema,
    version: z.number().int()
  })
})

export const sessionsPendingInputsChangedEvent = defineEventContract({
  name: 'sessions.pendingInputs.changed',
  payload: z.object({
    sessionId: EntityIdSchema,
    items: z.array(PendingSessionInputRecordSchema).optional(),
    version: z.number().int()
  })
})

export const sessionsAcpModesReadyEvent = defineEventContract({
  name: 'sessions.acp.modes.ready',
  payload: z.object({
    conversationId: EntityIdSchema.optional(),
    agentId: EntityIdSchema,
    workdir: z.string(),
    current: z.string(),
    available: z.array(AcpSessionModeSchema),
    version: z.number().int()
  })
})

export const sessionsAcpCommandsReadyEvent = defineEventContract({
  name: 'sessions.acp.commands.ready',
  payload: z.object({
    conversationId: EntityIdSchema,
    agentId: EntityIdSchema,
    commands: z.array(AcpSessionCommandSchema),
    version: z.number().int()
  })
})

export const sessionsAcpConfigOptionsReadyEvent = defineEventContract({
  name: 'sessions.acp.configOptions.ready',
  payload: z.object({
    conversationId: EntityIdSchema.optional(),
    agentId: EntityIdSchema,
    workdir: z.string(),
    configState: AcpConfigStateSchema,
    version: z.number().int()
  })
})
