import { z } from 'zod'
import type {
  SkillExtensionConfig,
  SkillFolderNode,
  SkillInstallOptions,
  SkillInstallResult,
  SkillMetadata,
  SkillScriptDescriptor
} from '@shared/types/skill'
import { EntityIdSchema, defineRouteContract } from '../common'

const SkillMetadataSchema = z.custom<SkillMetadata>()
const SkillInstallOptionsSchema = z.custom<SkillInstallOptions>().optional()
const SkillInstallResultSchema = z.custom<SkillInstallResult>()
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
