import { z } from 'zod'
import { defineRouteContract } from '../common'

export const NowledgeMemConfigSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  timeout: z.number().int().positive()
})

export const NowledgeMemConfigPatchSchema = NowledgeMemConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one config field must be provided'
)

export const NowledgeMemConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional()
})

export const nowledgeMemGetConfigRoute = defineRouteContract({
  name: 'nowledgeMem.getConfig',
  input: z.object({}).default({}),
  output: z.object({
    config: NowledgeMemConfigSchema
  })
})

export const nowledgeMemUpdateConfigRoute = defineRouteContract({
  name: 'nowledgeMem.updateConfig',
  input: z.object({
    config: NowledgeMemConfigPatchSchema
  }),
  output: z.object({
    config: NowledgeMemConfigSchema
  })
})

export const nowledgeMemTestConnectionRoute = defineRouteContract({
  name: 'nowledgeMem.testConnection',
  input: z.object({}).default({}),
  output: z.object({
    result: NowledgeMemConnectionResultSchema
  })
})

export type NowledgeMemConfig = z.infer<typeof NowledgeMemConfigSchema>
export type NowledgeMemConnectionResult = z.infer<typeof NowledgeMemConnectionResultSchema>
