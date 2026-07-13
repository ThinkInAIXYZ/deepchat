import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import {
  WorkspaceWatchHealthSchema,
  WorkspaceInvalidationKindSchema,
  WorkspaceInvalidationSourceSchema,
  WorkspaceWatchModeSchema,
  WorkspaceWatchStatusReasonSchema
} from '../domainSchemas'

export const workspaceInvalidatedEvent = defineEventContract({
  name: 'workspace.invalidated',
  payload: z.object({
    workspacePath: z.string(),
    kind: WorkspaceInvalidationKindSchema,
    source: WorkspaceInvalidationSourceSchema,
    version: TimestampMsSchema
  })
})

export const workspaceWatchStatusChangedEvent = defineEventContract({
  name: 'workspace.watch.status.changed',
  payload: z.object({
    workspacePath: z.string(),
    health: WorkspaceWatchHealthSchema,
    mode: WorkspaceWatchModeSchema,
    reason: WorkspaceWatchStatusReasonSchema,
    message: z.string().optional(),
    version: TimestampMsSchema
  })
})
