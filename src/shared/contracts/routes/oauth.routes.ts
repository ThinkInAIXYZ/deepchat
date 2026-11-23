import { z } from 'zod'
import { EntityIdSchema, defineRouteContract } from '../common'
import type { ChatGPTAuthStatus } from '../../types/chatgpt'
import type { XaiGrokAuthStatus } from '../../types/xai-grok'

export type { ChatGPTAuthStatus, ChatGPTLogoutResult } from '../../types/chatgpt'
export type { XaiGrokAuthStatus } from '../../types/xai-grok'

const OAuthProviderIdSchema = EntityIdSchema

const OAuthLoginResultSchema = z.object({
  success: z.boolean()
})

export const ChatGPTAuthStatusSchema: z.ZodType<ChatGPTAuthStatus> = z.object({
  state: z.enum([
    'signed-out',
    'pending-browser',
    'authenticated',
    'plan-disabled',
    'reauth-required',
    'error'
  ]),
  email: z.string().optional(),
  planUsageEnabled: z.boolean(),
  storage: z.enum(['safeStorage', 'file', 'none']),
  error: z.string().optional(),
  notices: z.object({
    welcome: z.boolean(),
    codexRetired: z.boolean()
  })
})

const ChatGPTStatusResultSchema = z.object({
  status: ChatGPTAuthStatusSchema
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

export const oauthChatGPTGetStatusRoute = defineRouteContract({
  name: 'oauth.chatgpt.getStatus',
  input: z.object({}),
  output: ChatGPTStatusResultSchema
})

export const oauthChatGPTStartLoginRoute = defineRouteContract({
  name: 'oauth.chatgpt.startLogin',
  input: z.object({
    requestPlanConsent: z.boolean().optional()
  }),
  output: ChatGPTStatusResultSchema
})

export const oauthChatGPTReopenBrowserRoute = defineRouteContract({
  name: 'oauth.chatgpt.reopenBrowser',
  input: z.object({}),
  output: ChatGPTStatusResultSchema
})

export const oauthChatGPTCancelLoginRoute = defineRouteContract({
  name: 'oauth.chatgpt.cancelLogin',
  input: z.object({}),
  output: ChatGPTStatusResultSchema
})

export const oauthChatGPTLogoutRoute = defineRouteContract({
  name: 'oauth.chatgpt.logout',
  input: z.object({}),
  output: z.object({
    status: ChatGPTAuthStatusSchema,
    revocationConfirmed: z.boolean()
  })
})

export const oauthChatGPTDismissNoticeRoute = defineRouteContract({
  name: 'oauth.chatgpt.dismissNotice',
  input: z.object({
    notice: z.enum(['welcome', 'codexRetired'])
  }),
  output: ChatGPTStatusResultSchema
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
