import { z } from 'zod'
import type {
  MCPServerConfig,
  McpSamplingDecision,
  McpSamplingRequestPayload
} from '@shared/presenter'
import { defineEventContract } from '../common'

const McpSamplingRequestSchema = z.custom<McpSamplingRequestPayload>()
const McpSamplingDecisionSchema = z.custom<McpSamplingDecision>()
const MCPServerConfigSchema = z.custom<MCPServerConfig>()

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
    mcpServers: z.record(MCPServerConfigSchema),
    mcpEnabled: z.boolean(),
    version: z.number().int()
  })
})

export const mcpServerStatusChangedEvent = defineEventContract({
  name: 'mcp.server.status.changed',
  payload: z.object({
    serverName: z.string(),
    isRunning: z.boolean(),
    version: z.number().int()
  })
})

export const mcpToolCallResultEvent = defineEventContract({
  name: 'mcp.toolCall.result',
  payload: z.object({
    functionName: z.string().optional(),
    content: z.custom<string | { type: string; text: string }[]>(),
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
    requestId: z.string(),
    reason: z.string().optional(),
    version: z.number().int()
  })
})
