import { z } from 'zod'
import { defineRouteContract } from '../common'
import { EnvironmentSummarySchema, ProjectSchema } from '../domainSchemas'

export const EnvironmentStatusSchema = z.enum(['active', 'archived', 'removed'])

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
  input: z
    .object({
      status: EnvironmentStatusSchema.optional()
    })
    .default({}),
  output: z.object({
    environments: z.array(EnvironmentSummarySchema)
  })
})

export const projectReorderEnvironmentsRoute = defineRouteContract({
  name: 'project.reorderEnvironments',
  input: z.object({
    paths: z.array(z.string().trim().min(1)).min(1)
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const projectArchiveEnvironmentRoute = defineRouteContract({
  name: 'project.archiveEnvironment',
  input: z.object({
    path: z.string().trim().min(1)
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const projectRestoreEnvironmentRoute = defineRouteContract({
  name: 'project.restoreEnvironment',
  input: z.object({
    path: z.string().trim().min(1)
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const projectRemoveEnvironmentRoute = defineRouteContract({
  name: 'project.removeEnvironment',
  input: z.object({
    path: z.string().trim().min(1)
  }),
  output: z.object({
    clearedSessionIds: z.array(z.string())
  })
})

export const projectOpenDirectoryRoute = defineRouteContract({
  name: 'project.openDirectory',
  input: z.object({
    path: z.string().trim().min(1)
  }),
  output: z.object({
    opened: z.boolean()
  })
})

export const projectPathExistsRoute = defineRouteContract({
  name: 'project.pathExists',
  input: z.object({
    path: z.string().trim().min(1)
  }),
  output: z.object({
    exists: z.boolean()
  })
})

export const projectSelectDirectoryRoute = defineRouteContract({
  name: 'project.selectDirectory',
  input: z.object({}).default({}),
  output: z.object({
    path: z.string().nullable()
  })
})
