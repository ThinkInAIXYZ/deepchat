import { z } from 'zod'
import { defineRouteContract } from '../common'

const UpdateInfoSchema = z
  .object({
    version: z.string(),
    releaseDate: z.string(),
    releaseNotes: z.string(),
    githubUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
    isMock: z.boolean().optional()
  })
  .nullable()

const UpdateProgressSchema = z
  .object({
    bytesPerSecond: z.number(),
    percent: z.number(),
    transferred: z.number(),
    total: z.number()
  })
  .nullable()

export const upgradeGetStatusRoute = defineRouteContract({
  name: 'upgrade.getStatus',
  input: z.object({}),
  output: z.object({
    snapshot: z.object({
      status: z
        .enum(['checking', 'available', 'not-available', 'downloading', 'downloaded', 'error'])
        .nullable(),
      progress: UpdateProgressSchema,
      error: z.string().nullable(),
      updateInfo: UpdateInfoSchema
    })
  })
})

export const upgradeCheckRoute = defineRouteContract({
  name: 'upgrade.check',
  input: z.object({
    type: z.string().optional()
  }),
  output: z.object({
    checked: z.literal(true)
  })
})

export const upgradeOpenDownloadRoute = defineRouteContract({
  name: 'upgrade.openDownload',
  input: z.object({
    type: z.enum(['github', 'official'])
  }),
  output: z.object({
    opened: z.literal(true)
  })
})

export const upgradeStartDownloadRoute = defineRouteContract({
  name: 'upgrade.startDownload',
  input: z.object({}),
  output: z.object({
    started: z.boolean()
  })
})

export const upgradeMockDownloadedRoute = defineRouteContract({
  name: 'upgrade.mockDownloaded',
  input: z.object({}),
  output: z.object({
    updated: z.boolean()
  })
})

export const upgradeClearMockRoute = defineRouteContract({
  name: 'upgrade.clearMock',
  input: z.object({}),
  output: z.object({
    updated: z.boolean()
  })
})

export const upgradeRestartToUpdateRoute = defineRouteContract({
  name: 'upgrade.restartToUpdate',
  input: z.object({}),
  output: z.object({
    restarted: z.boolean()
  })
})
