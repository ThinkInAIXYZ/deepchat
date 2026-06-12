import { z } from 'zod'
import { defineRouteContract } from '../common'
import { EnvironmentSummarySchema, ProjectSchema } from '../domainSchemas'

export const projectListRecentRoute = defineRouteContract({
  name: 'project.listRecent',
  input: z.object({
    limit: z.number().int().positive().optional()
  }),
  output: z.object({
    projects: z.array(ProjectSchema)
  })
})

export const projectListEnvironmentsRoute = defineRouteContract({
  name: 'project.listEnvironments',
  input: z.object({}).default({}),
  output: z.object({
    environments: z.array(EnvironmentSummarySchema)
  })
})

export const projectOpenDirectoryRoute = defineRouteContract({
  name: 'project.openDirectory',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    opened: z.boolean()
  })
})

export const projectSelectDirectoryRoute = defineRouteContract({
  name: 'project.selectDirectory',
  input: z.object({}).default({}),
  output: z.object({
    path: z.string().nullable()
  })
})
