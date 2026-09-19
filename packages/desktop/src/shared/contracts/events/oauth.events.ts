import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { OpenAICodexAuthStatusSchema, XaiGrokAuthStatusSchema } from '../routes/oauth.routes'

export const oauthOpenAICodexStatusChangedEvent = defineEventContract({
  name: 'oauth.openaiCodex.statusChanged',
  payload: z.object({
    status: OpenAICodexAuthStatusSchema,
    version: TimestampMsSchema
  })
})

export const oauthXaiGrokStatusChangedEvent = defineEventContract({
  name: 'oauth.xaiGrok.statusChanged',
  payload: z.object({
    status: XaiGrokAuthStatusSchema,
    version: TimestampMsSchema
  })
})
