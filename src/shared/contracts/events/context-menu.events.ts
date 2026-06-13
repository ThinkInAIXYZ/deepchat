import { z } from 'zod'
import { defineEventContract } from '../common'

export const contextMenuTranslateRequestedEvent = defineEventContract({
  name: 'contextMenu.translateRequested',
  payload: z.object({
    text: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional()
  })
})

export const contextMenuAskAiRequestedEvent = defineEventContract({
  name: 'contextMenu.askAiRequested',
  payload: z.object({
    text: z.string().min(1)
  })
})
