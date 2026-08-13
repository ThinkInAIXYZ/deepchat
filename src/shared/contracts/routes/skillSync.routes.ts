import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  SkillSyncExternalToolConfigSchema,
  SkillSyncNewDiscoverySchema,
  SkillSyncScanResultSchema
} from '../domainSchemas'

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
