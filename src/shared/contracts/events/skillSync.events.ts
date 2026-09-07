import { TimestampMsSchema, defineEventContract } from '../common'
import { SkillSyncNewDiscoverySchema, SkillSyncScanResultSchema } from '../domainSchemas'
import { z } from 'zod'

export const skillSyncDiscoveriesChangedEvent = defineEventContract({
  name: 'skillSync.discoveries.changed',
  payload: z.object({
    discoveries: z.array(SkillSyncNewDiscoverySchema),
    version: TimestampMsSchema
  })
})

export const skillSyncScanStartedEvent = defineEventContract({
  name: 'skillSync.scan.started',
  payload: z.object({
    version: TimestampMsSchema
  })
})

export const skillSyncScanCompletedEvent = defineEventContract({
  name: 'skillSync.scan.completed',
  payload: z.object({
    results: z.array(SkillSyncScanResultSchema),
    version: TimestampMsSchema
  })
})
