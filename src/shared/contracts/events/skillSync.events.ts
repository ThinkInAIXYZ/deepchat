import { TimestampMsSchema, defineEventContract } from '../common'
import {
  SkillSyncNewDiscoverySchema,
  SkillSyncOperationProgressSchema,
  SkillSyncResultSchema,
  SkillSyncScanResultSchema
} from '../domainSchemas'
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

export const skillSyncImportStartedEvent = defineEventContract({
  name: 'skillSync.import.started',
  payload: z.object({
    total: z.number().int().nonnegative(),
    version: TimestampMsSchema
  })
})

export const skillSyncImportProgressEvent = defineEventContract({
  name: 'skillSync.import.progress',
  payload: SkillSyncOperationProgressSchema.extend({
    version: TimestampMsSchema
  })
})

export const skillSyncImportCompletedEvent = defineEventContract({
  name: 'skillSync.import.completed',
  payload: z.object({
    result: SkillSyncResultSchema,
    version: TimestampMsSchema
  })
})

export const skillSyncExportStartedEvent = defineEventContract({
  name: 'skillSync.export.started',
  payload: z.object({
    total: z.number().int().nonnegative(),
    version: TimestampMsSchema
  })
})

export const skillSyncExportProgressEvent = defineEventContract({
  name: 'skillSync.export.progress',
  payload: SkillSyncOperationProgressSchema.extend({
    version: TimestampMsSchema
  })
})

export const skillSyncExportCompletedEvent = defineEventContract({
  name: 'skillSync.export.completed',
  payload: z.object({
    result: SkillSyncResultSchema,
    version: TimestampMsSchema
  })
})
