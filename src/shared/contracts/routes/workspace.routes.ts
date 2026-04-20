import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  WorkspaceFileNodeSchema,
  WorkspaceFilePreviewSchema,
  WorkspaceGitDiffSchema,
  WorkspaceGitStateSchema,
  WorkspaceLinkedFileResolutionSchema
} from '../domainSchemas'

const WorkspaceRegistrationModeSchema = z.enum(['workspace', 'workdir'])

export const workspaceRegisterRoute = defineRouteContract({
  name: 'workspace.register',
  input: z.object({
    workspacePath: z.string().min(1),
    mode: WorkspaceRegistrationModeSchema.default('workspace')
  }),
  output: z.object({
    registered: z.boolean()
  })
})

export const workspaceUnregisterRoute = defineRouteContract({
  name: 'workspace.unregister',
  input: z.object({
    workspacePath: z.string().min(1),
    mode: WorkspaceRegistrationModeSchema.default('workspace')
  }),
  output: z.object({
    unregistered: z.boolean()
  })
})

export const workspaceWatchRoute = defineRouteContract({
  name: 'workspace.watch',
  input: z.object({
    workspacePath: z.string().min(1)
  }),
  output: z.object({
    watching: z.boolean()
  })
})

export const workspaceUnwatchRoute = defineRouteContract({
  name: 'workspace.unwatch',
  input: z.object({
    workspacePath: z.string().min(1)
  }),
  output: z.object({
    watching: z.boolean()
  })
})

export const workspaceReadDirectoryRoute = defineRouteContract({
  name: 'workspace.readDirectory',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    nodes: z.array(WorkspaceFileNodeSchema)
  })
})

export const workspaceExpandDirectoryRoute = defineRouteContract({
  name: 'workspace.expandDirectory',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    nodes: z.array(WorkspaceFileNodeSchema)
  })
})

export const workspaceRevealFileInFolderRoute = defineRouteContract({
  name: 'workspace.revealFileInFolder',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    revealed: z.boolean()
  })
})

export const workspaceOpenFileRoute = defineRouteContract({
  name: 'workspace.openFile',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    opened: z.boolean()
  })
})

export const workspaceReadFilePreviewRoute = defineRouteContract({
  name: 'workspace.readFilePreview',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    preview: WorkspaceFilePreviewSchema.nullable()
  })
})

export const workspaceResolveMarkdownLinkedFileRoute = defineRouteContract({
  name: 'workspace.resolveMarkdownLinkedFile',
  input: z.object({
    workspacePath: z.string().nullable(),
    href: z.string().min(1),
    sourceFilePath: z.string().nullable().optional()
  }),
  output: z.object({
    resolution: WorkspaceLinkedFileResolutionSchema.nullable()
  })
})

export const workspaceGetGitStatusRoute = defineRouteContract({
  name: 'workspace.getGitStatus',
  input: z.object({
    workspacePath: z.string().min(1)
  }),
  output: z.object({
    state: WorkspaceGitStateSchema.nullable()
  })
})

export const workspaceGetGitDiffRoute = defineRouteContract({
  name: 'workspace.getGitDiff',
  input: z.object({
    workspacePath: z.string().min(1),
    filePath: z.string().optional()
  }),
  output: z.object({
    diff: WorkspaceGitDiffSchema.nullable()
  })
})

export const workspaceSearchFilesRoute = defineRouteContract({
  name: 'workspace.searchFiles',
  input: z.object({
    workspacePath: z.string().min(1),
    query: z.string()
  }),
  output: z.object({
    nodes: z.array(WorkspaceFileNodeSchema)
  })
})
