import { z } from 'zod'
import { defineRouteContract } from '../common'
import { WindowStateSchema } from '../domainSchemas'

export const windowGetCurrentStateRoute = defineRouteContract({
  name: 'window.getCurrentState',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowMinimizeCurrentRoute = defineRouteContract({
  name: 'window.minimizeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowToggleMaximizeCurrentRoute = defineRouteContract({
  name: 'window.toggleMaximizeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowCloseCurrentRoute = defineRouteContract({
  name: 'window.closeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    closed: z.boolean()
  })
})

export const windowCloseFloatingCurrentRoute = defineRouteContract({
  name: 'window.closeFloatingCurrent',
  input: z.object({}).default({}),
  output: z.object({
    closed: z.boolean()
  })
})

export const windowPreviewFileRoute = defineRouteContract({
  name: 'window.previewFile',
  input: z.object({
    filePath: z.string().min(1)
  }),
  output: z.object({
    previewed: z.boolean()
  })
})
