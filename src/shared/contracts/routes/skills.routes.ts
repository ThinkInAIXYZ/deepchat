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

export const skillsListMetadataRoute = defineRouteContract({
  name: 'skills.listMetadata',
  input: z.object({}),
  output: z.object({
    skills: z.array(SkillMetadataSchema)
  })
})

export const skillsListCatalogRoute = defineRouteContract({
  name: 'skills.listCatalog',
  input: z.object({}),
  output: z.object({
    skills: z.array(UnifiedSkillItemSchema)
  })
})

export const skillsSetDisabledRoute = defineRouteContract({
  name: 'skills.setDisabled',
  input: z.object({
    name: z.string().min(1),
    disabled: z.boolean()
  }),
  output: z.object({
    saved: z.literal(true)
  })
})

export const skillsGetDirectoryRoute = defineRouteContract({
  name: 'skills.getDirectory',
  input: z.object({}),
  output: z.object({
    path: z.string()
  })
})

export const skillsInstallFromFolderRoute = defineRouteContract({
  name: 'skills.installFromFolder',
  input: z.object({
    folderPath: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsInstallFromZipRoute = defineRouteContract({
  name: 'skills.installFromZip',
  input: z.object({
    zipPath: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsInstallFromUrlRoute = defineRouteContract({
  name: 'skills.installFromUrl',
  input: z.object({
    url: z.string(),
    options: SkillInstallOptionsSchema
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsScanGitRepoRoute = defineRouteContract({
  name: 'skills.scanGitRepo',
  input: z.object({
    repoUrl: z.string().min(1)
  }),
  output: z.object({
    result: GitSkillRepoScanResultSchema
  })
})

export const skillsInstallFromGitRoute = defineRouteContract({
  name: 'skills.installFromGit',
  input: z.object({
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
    skillsDirectory: z.string().min(1)
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
  input: z.object({
    name: z.string()
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsUpdateFileRoute = defineRouteContract({
  name: 'skills.updateFile',
  input: z.object({
    name: z.string(),
    content: z.string()
  }),
  output: z.object({
    result: SkillInstallResultSchema
  })
})

export const skillsReadFileRoute = defineRouteContract({
  name: 'skills.readFile',
  input: z.object({
    name: z.string().min(1)
  }),
  output: z.object({
    content: z.string()
  })
})

export const skillsSaveWithExtensionRoute = defineRouteContract({
  name: 'skills.saveWithExtension',
  input: z.object({
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
  input: z.object({
    name: z.string()
  }),
  output: z.object({
    nodes: z.array(SkillFolderNodeSchema)
  })
})

export const skillsOpenFolderRoute = defineRouteContract({
  name: 'skills.openFolder',
  input: z.object({}),
  output: z.object({
    opened: z.literal(true)
  })
})

export const skillsGetExtensionRoute = defineRouteContract({
  name: 'skills.getExtension',
  input: z.object({
    name: z.string()
  }),
  output: z.object({
    config: SkillExtensionConfigSchema
  })
})

export const skillsSaveExtensionRoute = defineRouteContract({
  name: 'skills.saveExtension',
  input: z.object({
    name: z.string(),
    config: SkillExtensionConfigSchema
  }),
  output: z.object({
    saved: z.literal(true)
  })
})

export const skillsListScriptsRoute = defineRouteContract({
  name: 'skills.listScripts',
  input: z.object({
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
