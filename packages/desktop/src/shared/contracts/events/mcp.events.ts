import { z } from 'zod'
import type {
  MCPServerConfig,
  MCPContentItem,
  McpAppConsentRequestPayload,
  McpElicitationDecision,
  McpElicitationRequestPayload,
  McpEnterpriseIdentityStatus,
  McpSamplingRequestPayload
} from '@shared/types/mcp'
import type {
  McpServerLifecycleStatus,
  McpServerStatusPhase,
  McpServerStatusReason
} from '@shared/types/core/mcp'
import { defineEventContract, JsonValueSchema } from '../common'
import { McpSamplingDecisionSchema, McpServerAuthStatusSchema } from '../routes/mcp.routes'

const McpSamplingMessageSchema = z.discriminatedUnion('type', [
  z.object({
    role: z.enum(['user', 'assistant']),
    type: z.literal('text'),
    text: z.string().max(1024 * 1024)
  }),
  z.object({
    role: z.enum(['user', 'assistant']),
    type: z.literal('image'),
    dataUrl: z.string().max(12 * 1024 * 1024),
    mimeType: z.string().min(1).max(256)
  }),
  z.object({
    role: z.enum(['user', 'assistant']),
    type: z.literal('audio'),
    dataUrl: z.string().max(12 * 1024 * 1024),
    mimeType: z.string().min(1).max(256)
  })
])
const McpSamplingRequestSchema: z.ZodType<McpSamplingRequestPayload> = z
  .object({
    requestId: z.string().min(1).max(256),
    serverName: z.string().min(1).max(256),
    serverLabel: z.string().max(512).optional(),
    serverId: z.string().min(1).max(256).optional(),
    configGeneration: z.number().int().positive().optional(),
    bindingHash: z.string().min(1).max(256).optional(),
    systemPrompt: z
      .string()
      .max(1024 * 1024)
      .optional(),
    maxTokens: z.number().int().positive().max(1_000_000).optional(),
    modelPreferences: z
      .object({
        costPriority: z.number().min(0).max(1).optional(),
        speedPriority: z.number().min(0).max(1).optional(),
        intelligencePriority: z.number().min(0).max(1).optional(),
        hints: z
          .array(z.object({ name: z.string().max(256).nullable().optional() }))
          .max(64)
          .optional()
      })
      .optional(),
    requiresVision: z.boolean(),
    messages: z.array(McpSamplingMessageSchema).max(128)
  })
  .refine(
    (value) => {
      try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 20 * 1024 * 1024
      } catch {
        return false
      }
    },
    { message: 'MCP sampling request exceeds the 20 MiB event limit' }
  )
const BoundedMcpJsonObjectSchema = z.record(z.string().max(256), JsonValueSchema).refine(
  (value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024
    } catch {
      return false
    }
  },
  { message: 'MCP JSON object exceeds the 2 MiB event limit' }
)
const McpElicitationRequestSchema: z.ZodType<McpElicitationRequestPayload> = z.object({
  requestId: z.string().min(1).max(256),
  serverName: z.string().min(1).max(256),
  mode: z.enum(['form', 'url']),
  message: z.string().max(16_384),
  requestedSchema: BoundedMcpJsonObjectSchema.optional(),
  url: z.url().max(4096).optional()
})
const McpElicitationDecisionSchema: z.ZodType<McpElicitationDecision> = z.object({
  requestId: z.string().min(1).max(256),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: BoundedMcpJsonObjectSchema.optional()
})
const McpAppConsentRequestSchema: z.ZodType<McpAppConsentRequestPayload> = z.object({
  requestId: z.string().min(1).max(256),
  kind: z.enum([
    'tool-call',
    'open-link',
    'send-message',
    'update-model-context',
    'camera',
    'microphone',
    'geolocation',
    'clipboard-write'
  ]),
  serverName: z.string().min(1).max(256),
  title: z.string().min(1).max(512),
  detail: z.string().max(32 * 1024),
  argumentsPreview: z
    .string()
    .max(16 * 1024)
    .optional(),
  url: z.url().max(4096).optional()
})
const MCPServerConfigSchema = z.custom<MCPServerConfig>()
const McpEnterpriseIdentityStatusSchema: z.ZodType<McpEnterpriseIdentityStatus> = z.object({
  profileId: z.string().min(1).max(128),
  state: z.enum(['signed_out', 'authenticating', 'authenticated', 'error']),
  authenticated: z.boolean(),
  persistent: z.boolean(),
  clientSecretConfigured: z.boolean(),
  subjectLabel: z.string().max(512).optional(),
  error: z.string().max(2048).optional(),
  updatedAt: z.number().int().nonnegative().optional()
})
const McpServerLifecycleStatusSchema = z.enum([
  'connecting',
  'connected',
  'timeout',
  'retrying',
  'failed',
  'stopped'
] satisfies [McpServerLifecycleStatus, ...McpServerLifecycleStatus[]])
const McpServerStatusPhaseSchema = z.enum(['startup', 'manual', 'retry', 'shutdown'] satisfies [
  McpServerStatusPhase,
  ...McpServerStatusPhase[]
])
const McpServerStatusReasonSchema = z.enum([
  'soft-timeout',
  'hard-timeout',
  'connect-error',
  'shutdown'
] satisfies [McpServerStatusReason, ...McpServerStatusReason[]])

export const mcpServerStartedEvent = defineEventContract({
  name: 'mcp.server.started',
  payload: z.object({
    serverName: z.string(),
    version: z.number().int()
  })
})

export const mcpServerStoppedEvent = defineEventContract({
  name: 'mcp.server.stopped',
  payload: z.object({
    serverName: z.string(),
    version: z.number().int()
  })
})

export const mcpConfigChangedEvent = defineEventContract({
  name: 'mcp.config.changed',
  payload: z.object({
    mcpServers: z.record(z.string(), MCPServerConfigSchema),
    mcpEnabled: z.boolean(),
    version: z.number().int()
  })
})

export const mcpServerStatusChangedEvent = defineEventContract({
  name: 'mcp.server.status.changed',
  payload: z.object({
    serverName: z.string(),
    name: z.string().optional(),
    lifecycleStatus: McpServerLifecycleStatusSchema,
    status: z.union([McpServerLifecycleStatusSchema, z.literal('running')]).optional(),
    isRunning: z.boolean(),
    phase: McpServerStatusPhaseSchema.optional(),
    attempt: z.number().int().positive().optional(),
    reason: McpServerStatusReasonSchema.optional(),
    message: z.string().optional(),
    version: z.number().int()
  })
})

export const mcpServerAuthChangedEvent = defineEventContract({
  name: 'mcp.server.auth.changed',
  payload: z.object({
    serverName: z.string(),
    status: McpServerAuthStatusSchema,
    version: z.number().int()
  })
})

export const mcpEnterpriseAuthChangedEvent = defineEventContract({
  name: 'mcp.enterprise.auth.changed',
  payload: z.object({
    status: McpEnterpriseIdentityStatusSchema,
    version: z.number().int()
  })
})

export const mcpToolCallResultEvent = defineEventContract({
  name: 'mcp.toolCall.result',
  payload: z.object({
    functionName: z.string().optional(),
    content: z.custom<string | MCPContentItem[]>(),
    version: z.number().int()
  })
})

export const mcpSamplingRequestEvent = defineEventContract({
  name: 'mcp.sampling.request',
  payload: z.object({
    request: McpSamplingRequestSchema,
    version: z.number().int()
  })
})

export const mcpSamplingDecisionEvent = defineEventContract({
  name: 'mcp.sampling.decision',
  payload: z.object({
    decision: McpSamplingDecisionSchema,
    version: z.number().int()
  })
})

export const mcpSamplingCancelledEvent = defineEventContract({
  name: 'mcp.sampling.cancelled',
  payload: z.object({
    requestId: z.string().min(1).max(256),
    reason: z.string().max(1024).optional(),
    version: z.number().int()
  })
})

export const mcpElicitationRequestEvent = defineEventContract({
  name: 'mcp.elicitation.request',
  payload: z.object({
    request: McpElicitationRequestSchema,
    version: z.number().int()
  })
})

export const mcpElicitationDecisionEvent = defineEventContract({
  name: 'mcp.elicitation.decision',
  payload: z.object({
    decision: McpElicitationDecisionSchema,
    version: z.number().int()
  })
})

export const mcpElicitationCancelledEvent = defineEventContract({
  name: 'mcp.elicitation.cancelled',
  payload: z.object({
    requestId: z.string().min(1).max(256),
    reason: z.string().max(1024).optional(),
    version: z.number().int()
  })
})

export const mcpAppConsentRequestEvent = defineEventContract({
  name: 'mcp.app.consent.request',
  payload: z.object({
    request: McpAppConsentRequestSchema,
    version: z.number().int()
  })
})
