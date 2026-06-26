import { z } from 'zod'
import { defineRouteContract } from '../common'
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
