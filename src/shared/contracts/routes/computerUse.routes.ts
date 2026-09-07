import { z } from 'zod'
import { defineRouteContract } from '../common'

const ComputerUsePreviewSurfaceSchema = z.enum(['native-overlay', 'renderer-canvas', 'none'])

export const computerUseSetPreviewModeRoute = defineRouteContract({
  name: 'computerUse.setPreviewMode',
  input: z.object({
    sessionId: z.string().min(1),
    mode: z.enum(['eligible', 'suspended', 'stopped'])
  }),
  output: z.object({
    updated: z.boolean(),
    surface: ComputerUsePreviewSurfaceSchema
  })
})

export const computerUseDismissPreviewRoute = defineRouteContract({
  name: 'computerUse.dismissPreview',
  input: z.object({
    sessionId: z.string().min(1),
    runId: z.string().min(1)
  }),
  output: z.object({
    dismissed: z.boolean()
  })
})
