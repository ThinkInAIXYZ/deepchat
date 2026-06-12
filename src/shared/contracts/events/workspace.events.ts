import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import {
  WorkspaceInvalidationKindSchema,
  WorkspaceInvalidationSourceSchema
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
