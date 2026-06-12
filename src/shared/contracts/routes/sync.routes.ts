import { z } from 'zod'
import type { SyncBackupInfo, CloudSyncResult } from '@shared/presenter'
import { defineRouteContract } from '../common'

const SyncBackupInfoSchema = z.custom<SyncBackupInfo>()
const CloudSyncResultSchema = z.custom<CloudSyncResult>()

const CloudSyncConfigViewSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string(),
  bucket: z.string(),
  region: z.string(),
  prefix: z.string(),
  accessKeyId: z.string(),
  hasSecret: z.boolean(),
  safeStorageAvailable: z.boolean()
})

const CloudSyncConfigInputSchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: z.string().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  prefix: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional()
})

export const syncGetBackupStatusRoute = defineRouteContract({
  name: 'sync.getBackupStatus',
  input: z.object({}),
  output: z.object({
    status: z.object({
      isBackingUp: z.boolean(),
      lastBackupTime: z.number()
    })
  })
})

export const syncListBackupsRoute = defineRouteContract({
  name: 'sync.listBackups',
  input: z.object({}),
  output: z.object({
    backups: z.array(SyncBackupInfoSchema)
  })
})

export const syncStartBackupRoute = defineRouteContract({
  name: 'sync.startBackup',
  input: z.object({}),
  output: z.object({
    backup: SyncBackupInfoSchema.nullable()
  })
})

export const syncImportRoute = defineRouteContract({
  name: 'sync.import',
  input: z.object({
    backupFile: z.string(),
    mode: z.enum(['increment', 'overwrite']).optional()
  }),
  output: z.object({
    result: z.object({
      success: z.boolean(),
      message: z.string(),
      count: z.number().optional(),
      sourceDbType: z.enum(['agent', 'chat']).optional(),
      importedSessions: z.number().optional()
    })
  })
})

export const syncOpenFolderRoute = defineRouteContract({
  name: 'sync.openFolder',
  input: z.object({}),
  output: z.object({
    opened: z.literal(true)
  })
})

// === Cloud sync (S3-compatible) ===

export const syncGetCloudConfigRoute = defineRouteContract({
  name: 'sync.getCloudConfig',
  input: z.object({}).default({}),
  output: z.object({
    config: CloudSyncConfigViewSchema
  })
})

export const syncSetCloudConfigRoute = defineRouteContract({
  name: 'sync.setCloudConfig',
  input: z.object({
    config: CloudSyncConfigInputSchema
  }),
  output: z.object({
    config: CloudSyncConfigViewSchema
  })
})

export const syncTestCloudRoute = defineRouteContract({
  name: 'sync.testCloud',
  input: z.object({}).default({}),
  output: z.object({
    result: CloudSyncResultSchema
  })
})

export const syncUploadToCloudRoute = defineRouteContract({
  name: 'sync.uploadToCloud',
  input: z.object({}).default({}),
  output: z.object({
    result: CloudSyncResultSchema
  })
})

export const syncPullFromCloudRoute = defineRouteContract({
  name: 'sync.pullFromCloud',
  input: z.object({
    mode: z.enum(['increment', 'overwrite']).optional()
  }),
  output: z.object({
    result: CloudSyncResultSchema
  })
})
