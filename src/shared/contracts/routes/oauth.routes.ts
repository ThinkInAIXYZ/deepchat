import { z } from 'zod'
import { EntityIdSchema, defineRouteContract } from '../common'
import type { OpenAICodexAuthStatus } from '../../types/openai-codex'

export type { OpenAICodexAuthStatus } from '../../types/openai-codex'

const OAuthProviderIdSchema = EntityIdSchema

const OAuthLoginResultSchema = z.object({
  success: z.boolean()
})

export const OpenAICodexAuthStatusSchema: z.ZodType<OpenAICodexAuthStatus> = z.object({
  state: z.enum(['disabled', 'signed-out', 'pending-browser', 'authenticated', 'error']),
  authenticated: z.boolean(),
  accountId: z.string().optional(),
  accountLabel: z.string().optional(),
  planType: z.string().optional(),
  expiresAt: z.number().optional(),
  storage: z.enum(['safeStorage', 'file', 'none']),
  error: z.string().optional()
})

const OpenAICodexStatusResultSchema = z.object({
  status: OpenAICodexAuthStatusSchema
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

export const oauthOpenAICodexGetStatusRoute = defineRouteContract({
  name: 'oauth.openaiCodex.getStatus',
  input: z.object({}),
  output: OpenAICodexStatusResultSchema
})

export const oauthOpenAICodexStartBrowserLoginRoute = defineRouteContract({
  name: 'oauth.openaiCodex.startBrowserLogin',
  input: z.object({}),
  output: OpenAICodexStatusResultSchema
})

export const oauthOpenAICodexCancelLoginRoute = defineRouteContract({
  name: 'oauth.openaiCodex.cancelLogin',
  input: z.object({}),
  output: OpenAICodexStatusResultSchema
})

export const oauthOpenAICodexLogoutRoute = defineRouteContract({
  name: 'oauth.openaiCodex.logout',
  input: z.object({}),
  output: OpenAICodexStatusResultSchema
})
