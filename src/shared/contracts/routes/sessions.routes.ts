import { z } from 'zod'
import {
  ChatMessageRecordSchema,
  EntityIdSchema,
  MessageFileSchema,
  PermissionModeSchema,
  SessionGenerationSettingsSchema,
  SessionWithStateSchema,
  defineRouteContract
} from '../common'

export const SessionListFiltersSchema = z
  .object({
    agentId: EntityIdSchema.optional(),
    projectDir: z.string().optional(),
    includeSubagents: z.boolean().optional(),
    parentSessionId: EntityIdSchema.optional()
  })
  .default({})

export const CreateSessionInputSchema = z.object({
  agentId: EntityIdSchema,
  message: z.string(),
  files: z.array(MessageFileSchema).optional(),
  projectDir: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  activeSkills: z.array(z.string()).optional(),
  disabledAgentTools: z.array(z.string()).optional(),
  subagentEnabled: z.boolean().optional(),
  generationSettings: SessionGenerationSettingsSchema.optional()
})

export const sessionsCreateRoute = defineRouteContract({
  name: 'sessions.create',
  input: CreateSessionInputSchema,
  output: z.object({
    session: SessionWithStateSchema
  })
})

export const sessionsRestoreRoute = defineRouteContract({
  name: 'sessions.restore',
  input: z.object({
    sessionId: EntityIdSchema
  }),
  output: z.object({
    session: SessionWithStateSchema.nullable(),
    messages: z.array(ChatMessageRecordSchema)
  })
})

export const sessionsListRoute = defineRouteContract({
  name: 'sessions.list',
  input: SessionListFiltersSchema,
  output: z.object({
    sessions: z.array(SessionWithStateSchema)
  })
})
