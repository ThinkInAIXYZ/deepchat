import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

const OpenAICodexAuthStatusSchema = z.object({
  state: z.enum([
    'disabled',
    'signed-out',
    'pending-browser',
    'pending-device',
    'authenticated',
    'error'
  ]),
  authenticated: z.boolean(),
  accountId: z.string().optional(),
  accountLabel: z.string().optional(),
  planType: z.string().optional(),
  expiresAt: z.number().optional(),
  storage: z.enum(['safeStorage', 'file', 'none']),
  device: z
    .object({
      userCode: z.string(),
      verificationUri: z.string(),
      expiresAt: z.number(),
      interval: z.number().optional()
    })
    .optional(),
  error: z.string().optional()
})

export const oauthOpenAICodexStatusChangedEvent = defineEventContract({
  name: 'oauth.openaiCodex.statusChanged',
  payload: z.object({
    status: OpenAICodexAuthStatusSchema,
    version: TimestampMsSchema
  })
})
