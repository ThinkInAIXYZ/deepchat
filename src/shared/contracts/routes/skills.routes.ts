import { z } from 'zod'
import type {
  GitSkillRepoScanResult,
  SkillExtensionConfig,
  SkillFolderNode,
  SkillSyncDirectoryExportPreview,
  SkillSyncDirectoryImportPreview,
  SkillSyncDirectoryResult,
  SkillInstallOptions,
  SkillInstallResult,
  SkillMetadata,
  SkillScriptDescriptor
} from '@shared/types/skill'
import type { SkillSyncDirectoryConfig, UnifiedSkillItem } from '@shared/types/skillManagement'
import type {
  AgentSkillImportPreview,
  AgentSkillImportResult,
  AgentSkillImportSourceInfo
} from '@shared/types/agentSkillImport'
import { EntityIdSchema, defineRouteContract } from '../common'

const SkillMetadataSchema = z.custom<SkillMetadata>()
const UnifiedSkillItemSchema = z.custom<UnifiedSkillItem>()
const SkillInstallOptionsSchema = z.custom<SkillInstallOptions>().optional()
const SkillInstallResultSchema = z.custom<SkillInstallResult>()
const SkillInstallConflictStrategySchema = z.enum(['rename', 'overwrite', 'skip']).optional()
const GitSkillRepoScanResultSchema = z.custom<GitSkillRepoScanResult>()
const SkillSyncDirectoryConfigSchema = z.custom<SkillSyncDirectoryConfig>().nullable()
const SkillSyncDirectoryExportPreviewSchema = z.custom<SkillSyncDirectoryExportPreview>()
const SkillSyncDirectoryImportPreviewSchema = z.custom<SkillSyncDirectoryImportPreview>()
const SkillSyncDirectoryResultSchema = z.custom<SkillSyncDirectoryResult>()
const SkillFolderNodeSchema = z.custom<SkillFolderNode>()
const SkillExtensionConfigSchema = z.custom<SkillExtensionConfig>()
const SkillScriptDescriptorSchema = z.custom<SkillScriptDescriptor>()
const AgentSkillImportSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('internal'), agentId: EntityIdSchema }),
  z.object({ kind: z.literal('external'), toolId: z.string().trim().min(1) })
])
const AgentSkillImportSourceInfoSchema = z.custom<AgentSkillImportSourceInfo>()
const AgentSkillImportPreviewSchema = z.custom<AgentSkillImportPreview>()
const AgentSkillImportResultSchema = z.custom<AgentSkillImportResult>()
const AgentSkillImportConflictStrategySchema = z.enum(['skip', 'rename', 'overwrite'])
const AgentSkillImportNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
const AgentSkillImportSelectionsSchema = z
  .array(
    z.object({
      skillName: AgentSkillImportNameSchema,
      strategy: AgentSkillImportConflictStrategySchema
    })
  )
  .min(1)
  .superRefine((items, context) => {
    const seen = new Set<string>()
    items.forEach((item, index) => {
      if (seen.has(item.skillName)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Skill selection: ${item.skillName}`,
          path: [index, 'skillName']
        })
      }
      seen.add(item.skillName)
    })
  })
const AgentSkillScopeSchema = z.object({ agentId: EntityIdSchema })

export const skillsListMetadataRoute = defineRouteContract({
  name: 'skills.listMetadata',
  input: AgentSkillScopeSchema,
  output: z.object({
    skills: z.array(SkillMetadataSchema)
  })
})

export const skillsListCatalogRoute = defineRouteContract({
  name: 'skills.listCatalog',
  input: AgentSkillScopeSchema,
  output: z.object({
    skills: z.array(UnifiedSkillItemSchema)
  })
})

export const skillsSetDisabledRoute = defineRouteContract({
  name: 'skills.setDisabled',
  input: AgentSkillScopeSchema.extend({
    name: z.string().min(1),
    disabled: z.boolean()
  }),
  output: z.object({
    saved: z.literal(true)
  })
})

export const skillsGetDirectoryRoute = defineRouteContract({
  name: 'skills.getDirectory',
  input: AgentSkillScopeSchema,
  output: z.object({
    path: z.string()
  })
})

export const skillsInstallFromFolderRoute = defineRouteContract({
  name: 'skills.installFromFolder',
  input: AgentSkillScopeSchema.extend({
    folderPath: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsInstallFromZipRoute = defineRouteContract({
  name: 'skills.installFromZip',
  input: AgentSkillScopeSchema.extend({
    zipPath: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsInstallFromUrlRoute = defineRouteContract({
  name: 'skills.installFromUrl',
  input: AgentSkillScopeSchema.extend({
    url: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsScanGitRepoRoute = defineRouteContract({
  name: 'skills.scanGitRepo',
  input: AgentSkillScopeSchema.extend({
    repoUrl: z.string().min(1)
  }),
  output: z.object({
    result: GitSkillRepoScanResultSchema
  })
})

export const skillsInstallFromGitRoute = defineRouteContract({
  name: 'skills.installFromGit',
  input: AgentSkillScopeSchema.extend({
    repoUrl: z.string().min(1),
    skillNames: z.array(z.string().min(1)),
    strategy: SkillInstallConflictStrategySchema
  }),
  output: z.object({
    results: z.array(SkillInstallResultSchema)
  })
})

export const skillsGetSyncConfigRoute = defineRouteContract({
  name: 'skills.getSyncConfig',
  input: z.object({}),
  output: z.object({
    config: SkillSyncDirectoryConfigSchema
  })
})

export const skillsSetSyncDirectoryRoute = defineRouteContract({
  name: 'skills.setSyncDirectory',
  input: z.object({
    skillsDirectory: z.string().trim().min(1)
  }),
  output: z.object({
    config: z.custom<SkillSyncDirectoryConfig>()
  })
})

export const skillsPreviewSyncDirectoryExportRoute = defineRouteContract({
  name: 'skills.previewSyncDirectoryExport',
  input: z.object({
    skillNames: z.array(z.string().min(1)),
    includeDisabled: z.boolean().optional()
  }),
  output: z.object({
    preview: SkillSyncDirectoryExportPreviewSchema
  })
})

export const skillsExecuteSyncDirectoryExportRoute = defineRouteContract({
  name: 'skills.executeSyncDirectoryExport',
  input: z.object({
    skillNames: z.array(z.string().min(1)),
    includeDisabled: z.boolean().optional()
  }),
  output: z.object({
    result: SkillSyncDirectoryResultSchema
  })
})

export const skillsPreviewSyncDirectoryImportRoute = defineRouteContract({
  name: 'skills.previewSyncDirectoryImport',
  input: z.object({}),
  output: z.object({
    preview: SkillSyncDirectoryImportPreviewSchema
  })
})

export const skillsExecuteSyncDirectoryImportRoute = defineRouteContract({
  name: 'skills.executeSyncDirectoryImport',
  input: z.object({
    skillNames: z.array(z.string().min(1)),
    strategy: SkillInstallConflictStrategySchema
  }),
  output: z.object({
    result: SkillSyncDirectoryResultSchema
  })
})

export const skillsUninstallRoute = defineRouteContract({
  name: 'skills.uninstall',
  input: AgentSkillScopeSchema.extend({
    name: z.string()
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsUpdateFileRoute = defineRouteContract({
  name: 'skills.updateFile',
  input: AgentSkillScopeSchema.extend({
    name: z.string(),
    content: z.string()
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsReadFileRoute = defineRouteContract({
  name: 'skills.readFile',
  input: AgentSkillScopeSchema.extend({
    name: z.string().min(1)
  }),
  output: z.object({
    content: z.string()
  })
})

export const skillsSaveWithExtensionRoute = defineRouteContract({
  name: 'skills.saveWithExtension',
  input: AgentSkillScopeSchema.extend({
    name: z.string(),
    content: z.string(),
    config: SkillExtensionConfigSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsGetFolderTreeRoute = defineRouteContract({
  name: 'skills.getFolderTree',
  input: AgentSkillScopeSchema.extend({
    name: z.string()
  }),
  output: z.object({
    nodes: z.array(SkillFolderNodeSchema)
  })
})

export const skillsOpenFolderRoute = defineRouteContract({
  name: 'skills.openFolder',
  input: AgentSkillScopeSchema,
  output: z.object({
    opened: z.literal(true)
  })
})

export const skillsGetExtensionRoute = defineRouteContract({
  name: 'skills.getExtension',
  input: AgentSkillScopeSchema.extend({
    name: z.string()
  }),
  output: z.object({
    config: SkillExtensionConfigSchema
  })
})

export const skillsSaveExtensionRoute = defineRouteContract({
  name: 'skills.saveExtension',
  input: AgentSkillScopeSchema.extend({
    name: z.string(),
    config: SkillExtensionConfigSchema
  }),
  output: z.object({
    saved: z.literal(true)
  })
})

export const skillsListScriptsRoute = defineRouteContract({
  name: 'skills.listScripts',
  input: AgentSkillScopeSchema.extend({
    name: z.string()
  }),
  output: z.object({
    scripts: z.array(SkillScriptDescriptorSchema)
  })
})

export const skillsGetActiveRoute = defineRouteContract({
  name: 'skills.getActive',
  input: z.object({
    conversationId: EntityIdSchema
  }),
  output: z.object({
    skills: z.array(z.string())
  })
})

export const skillsSetActiveRoute = defineRouteContract({
  name: 'skills.setActive',
  input: z.object({
    conversationId: EntityIdSchema,
    skills: z.array(z.string())
  }),
  output: z.object({
    skills: z.array(z.string())
  })
})

export const skillsListAgentImportSourcesRoute = defineRouteContract({
  name: 'skills.listAgentImportSources',
  input: z.object({
    targetAgentId: EntityIdSchema
  }),
  output: z.object({
    sources: z.array(AgentSkillImportSourceInfoSchema)
  })
})

export const skillsPreviewAgentImportRoute = defineRouteContract({
  name: 'skills.previewAgentImport',
  input: z.object({
    targetAgentId: EntityIdSchema,
    source: AgentSkillImportSourceSchema,
    skillNames: z.array(AgentSkillImportNameSchema).optional()
  }),
  output: z.object({
    preview: AgentSkillImportPreviewSchema
  })
})

export const skillsExecuteAgentImportRoute = defineRouteContract({
  name: 'skills.executeAgentImport',
  input: z.object({
    targetAgentId: EntityIdSchema,
    source: AgentSkillImportSourceSchema,
    items: AgentSkillImportSelectionsSchema
  }),
  output: z.object({
    result: AgentSkillImportResultSchema
  })
})
