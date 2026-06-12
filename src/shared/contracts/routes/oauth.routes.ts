import { z } from 'zod'
import { EntityIdSchema, defineRouteContract } from '../common'

const OAuthProviderIdSchema = EntityIdSchema

const OAuthLoginResultSchema = z.object({
  success: z.boolean()
})

export const oauthGithubCopilotStartLoginRoute = defineRouteContract({
  name: 'oauth.githubCopilot.startLogin',
  input: z.object({
    providerId: OAuthProviderIdSchema
  }),
  output: OAuthLoginResultSchema
})

export const oauthGithubCopilotStartDeviceFlowLoginRoute = defineRouteContract({
  name: 'oauth.githubCopilot.startDeviceFlowLogin',
  input: z.object({
    providerId: OAuthProviderIdSchema
  }),
  output: OAuthLoginResultSchema
})
