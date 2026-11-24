import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { ChatGPTAuthStatusSchema, XaiGrokAuthStatusSchema } from '../routes/oauth.routes'

export const oauthChatGPTStatusChangedEvent = defineEventContract({
  name: 'oauth.chatgpt.statusChanged',
  payload: z.object({
    status: ChatGPTAuthStatusSchema,
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
