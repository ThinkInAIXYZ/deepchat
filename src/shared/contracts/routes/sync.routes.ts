import { z } from 'zod'
import type { SyncBackupInfo } from '@shared/presenter'
import { defineRouteContract } from '../common'

const SyncBackupInfoSchema = z.custom<SyncBackupInfo>()

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
