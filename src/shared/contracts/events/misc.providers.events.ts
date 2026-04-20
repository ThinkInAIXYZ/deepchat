import { z } from 'zod'
import { defineEventContract } from '../common'

export const providersOllamaPullProgressEvent = defineEventContract({
  name: 'providers.ollama.pull.progress',
  payload: z.object({
    eventId: z.string(),
    providerId: z.string(),
    modelName: z.string(),
    completed: z.number().optional(),
    total: z.number().optional(),
    status: z.string().optional(),
    version: z.number().int()
  })
})
