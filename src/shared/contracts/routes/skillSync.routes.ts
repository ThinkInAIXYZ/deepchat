import { z } from 'zod'
import { defineRouteContract } from '../common'
import type {
  AdoptAgentSkillPreview,
  AdoptAgentSkillResult,
  LinkDeepChatSkillResult,
  LinkDeepChatSkillsPreview,
  LinkDeepChatSkillsResult,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  SkillDetail
} from '../../types/skillSync'
import {
  SkillSyncConflictStrategySchema,
  SkillSyncExportPreviewSchema,
  SkillSyncExternalToolConfigSchema,
  SkillSyncImportPreviewSchema,
  SkillSyncNewDiscoverySchema,
  SkillSyncResultSchema,
  SkillSyncScanResultSchema
} from '../domainSchemas'

const ToolIdSchema = z.string().min(1)
const SkillNameSchema = z.string().min(1)
const ConflictStrategiesSchema = z.record(z.string(), SkillSyncConflictStrategySchema)
const ExportOptionsSchema = z.record(z.string(), z.unknown()).optional()
const InstalledSkillAgentSchema = z.custom<InstalledSkillAgent>()
const InstalledSkillAgentDetailSchema = z.custom<InstalledSkillAgentDetail>()
const SkillDetailSchema = z.custom<SkillDetail>()
const AdoptAgentSkillPreviewSchema = z.custom<AdoptAgentSkillPreview>()
const AdoptAgentSkillResultSchema = z.custom<AdoptAgentSkillResult>()
const AdoptAgentSkillInputSchema = z.object({
  agentId: ToolIdSchema,
  skillName: SkillNameSchema,
  targetName: SkillNameSchema.optional()
})
const LinkDeepChatSkillsPreviewSchema = z.custom<LinkDeepChatSkillsPreview>()
const LinkDeepChatSkillsResultSchema = z.custom<LinkDeepChatSkillsResult>()
const LinkDeepChatSkillResultSchema = z.custom<LinkDeepChatSkillResult>()
const LinkDeepChatSkillsInputSchema = z.object({
  agentId: ToolIdSchema,
  skillNames: z.array(SkillNameSchema)
})
const AgentSkillLinkInputSchema = z.object({
  agentId: ToolIdSchema,
  skillName: SkillNameSchema
})

export const skillSyncScanExternalToolsRoute = defineRouteContract({
  name: 'skillSync.scanExternalTools',
  input: z.object({}).default({}),
  output: z.object({
    results: z.array(SkillSyncScanResultSchema)
  })
})

export const skillSyncGetNewDiscoveriesRoute = defineRouteContract({
  name: 'skillSync.getNewDiscoveries',
  input: z.object({}).default({}),
  output: z.object({
    discoveries: z.array(SkillSyncNewDiscoverySchema)
  })
})

export const skillSyncAcknowledgeDiscoveriesRoute = defineRouteContract({
  name: 'skillSync.acknowledgeDiscoveries',
  input: z.object({}).default({}),
  output: z.object({
    acknowledged: z.boolean()
  })
})

export const skillSyncGetRegisteredToolsRoute = defineRouteContract({
  name: 'skillSync.getRegisteredTools',
  input: z.object({}).default({}),
  output: z.object({
    tools: z.array(SkillSyncExternalToolConfigSchema)
  })
})

export const skillSyncScanAgentsRoute = defineRouteContract({
  name: 'skillSync.scanAgents',
  input: z.object({}).default({}),
  output: z.object({
    agents: z.array(InstalledSkillAgentSchema)
  })
})

export const skillSyncGetAgentDetailRoute = defineRouteContract({
  name: 'skillSync.getAgentDetail',
  input: z.object({
    agentId: ToolIdSchema
  }),
  output: z.object({
    agent: InstalledSkillAgentDetailSchema
  })
})

export const skillSyncGetAgentSkillDetailRoute = defineRouteContract({
  name: 'skillSync.getAgentSkillDetail',
  input: z.object({
    agentId: ToolIdSchema,
    skillName: SkillNameSchema
  }),
  output: z.object({
    detail: SkillDetailSchema
  })
})

export const skillSyncPreviewAdoptAgentSkillRoute = defineRouteContract({
  name: 'skillSync.previewAdoptAgentSkill',
  input: AdoptAgentSkillInputSchema,
  output: z.object({
    preview: AdoptAgentSkillPreviewSchema
  })
})

export const skillSyncExecuteAdoptAgentSkillRoute = defineRouteContract({
  name: 'skillSync.executeAdoptAgentSkill',
  input: AdoptAgentSkillInputSchema,
  output: z.object({
    result: AdoptAgentSkillResultSchema
  })
})

export const skillSyncPreviewLinkDeepChatSkillsRoute = defineRouteContract({
  name: 'skillSync.previewLinkDeepChatSkills',
  input: LinkDeepChatSkillsInputSchema,
  output: z.object({
    preview: LinkDeepChatSkillsPreviewSchema
  })
})

export const skillSyncExecuteLinkDeepChatSkillsRoute = defineRouteContract({
  name: 'skillSync.executeLinkDeepChatSkills',
  input: LinkDeepChatSkillsInputSchema,
  output: z.object({
    result: LinkDeepChatSkillsResultSchema
  })
})

export const skillSyncRepairAgentSkillLinkRoute = defineRouteContract({
  name: 'skillSync.repairAgentSkillLink',
  input: AgentSkillLinkInputSchema,
  output: z.object({
    result: LinkDeepChatSkillResultSchema
  })
})

export const skillSyncRemoveAgentSkillLinkRoute = defineRouteContract({
  name: 'skillSync.removeAgentSkillLink',
  input: AgentSkillLinkInputSchema,
  output: z.object({
    result: LinkDeepChatSkillResultSchema
  })
})

export const skillSyncPreviewImportRoute = defineRouteContract({
  name: 'skillSync.previewImport',
  input: z.object({
    toolId: ToolIdSchema,
    skillNames: z.array(SkillNameSchema)
  }),
  output: z.object({
    previews: z.array(SkillSyncImportPreviewSchema)
  })
})

export const skillSyncExecuteImportRoute = defineRouteContract({
  name: 'skillSync.executeImport',
  input: z.object({
    previews: z.array(SkillSyncImportPreviewSchema),
    strategies: ConflictStrategiesSchema
  }),
  output: z.object({
    result: SkillSyncResultSchema
  })
})

export const skillSyncPreviewExportRoute = defineRouteContract({
  name: 'skillSync.previewExport',
  input: z.object({
    skillNames: z.array(SkillNameSchema),
    targetToolId: ToolIdSchema,
    options: ExportOptionsSchema
  }),
  output: z.object({
    previews: z.array(SkillSyncExportPreviewSchema)
  })
})

export const skillSyncExecuteExportRoute = defineRouteContract({
  name: 'skillSync.executeExport',
  input: z.object({
    previews: z.array(SkillSyncExportPreviewSchema),
    strategies: ConflictStrategiesSchema
  }),
  output: z.object({
    result: SkillSyncResultSchema
  })
})
