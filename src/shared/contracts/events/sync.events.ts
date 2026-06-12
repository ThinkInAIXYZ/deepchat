import { z } from 'zod'
import { defineEventContract } from '../common'

export const syncBackupStartedEvent = defineEventContract({
  name: 'sync.backup.started',
  payload: z.object({
    version: z.number().int()
  })
})

export const syncBackupCompletedEvent = defineEventContract({
  name: 'sync.backup.completed',
  payload: z.object({
    timestamp: z.number(),
    version: z.number().int()
  })
})

export const syncBackupErrorEvent = defineEventContract({
  name: 'sync.backup.error',
  payload: z.object({
    error: z.string().optional(),
    version: z.number().int()
  })
})

export const syncBackupStatusChangedEvent = defineEventContract({
  name: 'sync.backup.status.changed',
  payload: z.object({
    status: z.string(),
    previousStatus: z.string().optional(),
    lastSuccessfulBackupTime: z.number().optional(),
    failed: z.boolean().optional(),
    message: z.string().optional(),
    version: z.number().int()
  })
})

export const syncImportStartedEvent = defineEventContract({
  name: 'sync.import.started',
  payload: z.object({
    version: z.number().int()
  })
})

export const syncImportCompletedEvent = defineEventContract({
  name: 'sync.import.completed',
  payload: z.object({
    version: z.number().int()
  })
})

export const syncImportErrorEvent = defineEventContract({
  name: 'sync.import.error',
  payload: z.object({
    error: z.string().optional(),
    version: z.number().int()
  })
})
