import { z } from 'zod'
import { EntityIdSchema, defineRouteContract } from '../common'
import type { OpenAICodexAuthStatus } from '../../types/openai-codex'
import type { XaiGrokAuthStatus } from '../../types/xai-grok'

export type { OpenAICodexAuthStatus } from '../../types/openai-codex'
export type { XaiGrokAuthStatus } from '../../types/xai-grok'

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

export const XaiGrokAuthStatusSchema: z.ZodType<XaiGrokAuthStatus> = z.object({
  state: z.enum(['disabled', 'signed-out', 'pending-device', 'authenticated', 'error']),
  authenticated: z.boolean(),
  accountId: z.string().optional(),
  accountLabel: z.string().optional(),
  expiresAt: z.number().optional(),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  verificationUriComplete: z.string().optional(),
  storage: z.enum(['safeStorage', 'file', 'none']),
  error: z.string().optional()
})

const XaiGrokStatusResultSchema = z.object({
  status: XaiGrokAuthStatusSchema
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

export const oauthOpenAICodexCompleteBrowserLoginFromUrlRoute = defineRouteContract({
  name: 'oauth.openaiCodex.completeBrowserLoginFromUrl',
  input: z.object({
    callbackUrl: z.url()
  }),
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

export const oauthXaiGrokGetStatusRoute = defineRouteContract({
  name: 'oauth.xaiGrok.getStatus',
  input: z.object({}),
  output: XaiGrokStatusResultSchema
})

export const oauthXaiGrokStartDeviceLoginRoute = defineRouteContract({
  name: 'oauth.xaiGrok.startDeviceLogin',
  input: z.object({}),
  output: XaiGrokStatusResultSchema
})

export const oauthXaiGrokCancelLoginRoute = defineRouteContract({
  name: 'oauth.xaiGrok.cancelLogin',
  input: z.object({}),
  output: XaiGrokStatusResultSchema
})

export const oauthXaiGrokLogoutRoute = defineRouteContract({
  name: 'oauth.xaiGrok.logout',
  input: z.object({}),
  output: XaiGrokStatusResultSchema
})
