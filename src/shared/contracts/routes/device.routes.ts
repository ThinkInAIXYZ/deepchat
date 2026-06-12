import { z } from 'zod'
import { defineRouteContract } from '../common'
import { DeviceInfoSchema } from '../domainSchemas'

export const deviceGetAppVersionRoute = defineRouteContract({
  name: 'device.getAppVersion',
  input: z.object({}).default({}),
  output: z.object({
    version: z.string()
  })
})

export const deviceGetInfoRoute = defineRouteContract({
  name: 'device.getInfo',
  input: z.object({}).default({}),
  output: z.object({
    info: DeviceInfoSchema
  })
})

export const deviceSelectDirectoryRoute = defineRouteContract({
  name: 'device.selectDirectory',
  input: z.object({}).default({}),
  output: z.object({
    canceled: z.boolean(),
    filePaths: z.array(z.string())
  })
})

export const deviceRestartAppRoute = defineRouteContract({
  name: 'device.restartApp',
  input: z.object({}).default({}),
  output: z.object({
    restarted: z.boolean()
  })
})

export const deviceSanitizeSvgRoute = defineRouteContract({
  name: 'device.sanitizeSvg',
  input: z.object({
    svgContent: z.string()
  }),
  output: z.object({
    content: z.string().nullable()
  })
})
