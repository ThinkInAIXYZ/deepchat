import { z } from 'zod'
import { defineEventContract } from '../common'

const UpgradeInfoSchema = z
  .object({
    version: z.string(),
    // electron-updater may emit a Date when latest*.yml leaves releaseDate
    // unquoted (js-yaml timestamp tag). Accept both and coerce to string so the
    // publish pipeline and the client never disagree on shape.
    releaseDate: z
      .union([z.string(), z.date()])
      .transform((value) => (value instanceof Date ? value.toISOString() : value)),
    releaseNotes: z.string(),
    githubUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
    isMock: z.boolean().optional()
  })
  .nullable()

export const upgradeStatusChangedEvent = defineEventContract({
  name: 'upgrade.status.changed',
  payload: z.object({
    status: z
      .enum(['checking', 'available', 'not-available', 'downloading', 'downloaded', 'error'])
      .nullable(),
    error: z.string().optional().nullable(),
    info: UpgradeInfoSchema.optional(),
    type: z.string().optional(),
    version: z.number().int()
  })
})

export const upgradeProgressEvent = defineEventContract({
  name: 'upgrade.progress',
  payload: z.object({
    bytesPerSecond: z.number(),
    percent: z.number(),
    transferred: z.number(),
    total: z.number(),
    version: z.number().int()
  })
})

export const upgradeWillRestartEvent = defineEventContract({
  name: 'upgrade.willRestart',
  payload: z.object({
    version: z.number().int()
  })
})

export const upgradeErrorEvent = defineEventContract({
  name: 'upgrade.error',
  payload: z.object({
    error: z.string(),
    version: z.number().int()
  })
})
