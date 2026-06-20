import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { OpenAICodexAuthStatusSchema } from '../routes/oauth.routes'

export const oauthOpenAICodexStatusChangedEvent = defineEventContract({
  name: 'oauth.openaiCodex.statusChanged',
  payload: z.object({
    status: OpenAICodexAuthStatusSchema,
    version: TimestampMsSchema
  })
})
