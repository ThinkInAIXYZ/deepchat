import { z } from 'zod'
import type {
  MCPServerConfig,
  MCPToolCall,
  MCPToolDefinition,
  MCPToolResponse,
  McpClient,
  McpSamplingDecision,
  PromptListEntry,
  Resource,
  ResourceListEntry
} from '@shared/presenter'
import { defineRouteContract } from '../common'

const MCPServerConfigSchema = z.custom<MCPServerConfig>()
const McpClientSchema = z.custom<McpClient>()
const MCPToolDefinitionSchema = z.custom<MCPToolDefinition>()
const PromptListEntrySchema = z.custom<PromptListEntry>()
const ResourceListEntrySchema = z.custom<ResourceListEntry>()
const ResourceSchema = z.custom<Resource>()
const MCPToolCallSchema = z.custom<MCPToolCall>()
const MCPToolResponseSchema = z.custom<MCPToolResponse>()
const McpSamplingDecisionSchema = z.custom<McpSamplingDecision>()
const NpmRegistryStatusSchema = z.custom<{
  currentRegistry: string | null
  isFromCache: boolean
  lastChecked?: number
  autoDetectEnabled: boolean
  customRegistry?: string
}>()

export const mcpGetServersRoute = defineRouteContract({
  name: 'mcp.getServers',
  input: z.object({}),
  output: z.object({
    servers: z.record(MCPServerConfigSchema)
  })
})

export const mcpGetEnabledRoute = defineRouteContract({
  name: 'mcp.getEnabled',
  input: z.object({}),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpGetClientsRoute = defineRouteContract({
  name: 'mcp.getClients',
  input: z.object({}),
  output: z.object({
    clients: z.array(McpClientSchema)
  })
})

export const mcpListToolDefinitionsRoute = defineRouteContract({
  name: 'mcp.listToolDefinitions',
  input: z.object({
    enabledMcpTools: z.array(z.string()).optional()
  }),
  output: z.object({
    tools: z.array(MCPToolDefinitionSchema)
  })
})

export const mcpListPromptsRoute = defineRouteContract({
  name: 'mcp.listPrompts',
  input: z.object({}),
  output: z.object({
    prompts: z.array(PromptListEntrySchema)
  })
})

export const mcpListResourcesRoute = defineRouteContract({
  name: 'mcp.listResources',
  input: z.object({}),
  output: z.object({
    resources: z.array(ResourceListEntrySchema)
  })
})

export const mcpCallToolRoute = defineRouteContract({
  name: 'mcp.callTool',
  input: z.object({
    request: MCPToolCallSchema
  }),
  output: z.object({
    content: z.string(),
    rawData: MCPToolResponseSchema
  })
})

export const mcpAddServerRoute = defineRouteContract({
  name: 'mcp.addServer',
  input: z.object({
    serverName: z.string(),
    config: MCPServerConfigSchema
  }),
  output: z.object({
    success: z.boolean()
  })
})

export const mcpUpdateServerRoute = defineRouteContract({
  name: 'mcp.updateServer',
  input: z.object({
    serverName: z.string(),
    config: z.custom<Partial<MCPServerConfig>>()
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const mcpRemoveServerRoute = defineRouteContract({
  name: 'mcp.removeServer',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const mcpSetServerEnabledRoute = defineRouteContract({
  name: 'mcp.setServerEnabled',
  input: z.object({
    serverName: z.string(),
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpSetEnabledRoute = defineRouteContract({
  name: 'mcp.setEnabled',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpIsServerRunningRoute = defineRouteContract({
  name: 'mcp.isServerRunning',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    running: z.boolean()
  })
})

export const mcpStartServerRoute = defineRouteContract({
  name: 'mcp.startServer',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    started: z.literal(true)
  })
})

export const mcpStopServerRoute = defineRouteContract({
  name: 'mcp.stopServer',
  input: z.object({
    serverName: z.string()
  }),
  output: z.object({
    stopped: z.literal(true)
  })
})

export const mcpGetPromptRoute = defineRouteContract({
  name: 'mcp.getPrompt',
  input: z.object({
    prompt: PromptListEntrySchema,
    args: z.record(z.unknown()).optional()
  }),
  output: z.object({
    result: z.unknown()
  })
})

export const mcpReadResourceRoute = defineRouteContract({
  name: 'mcp.readResource',
  input: z.object({
    resource: ResourceListEntrySchema
  }),
  output: z.object({
    resource: ResourceSchema
  })
})

export const mcpSubmitSamplingDecisionRoute = defineRouteContract({
  name: 'mcp.submitSamplingDecision',
  input: z.object({
    decision: McpSamplingDecisionSchema
  }),
  output: z.object({
    submitted: z.literal(true)
  })
})

export const mcpCancelSamplingRequestRoute = defineRouteContract({
  name: 'mcp.cancelSamplingRequest',
  input: z.object({
    requestId: z.string(),
    reason: z.string().optional()
  }),
  output: z.object({
    cancelled: z.literal(true)
  })
})

export const mcpGetNpmRegistryStatusRoute = defineRouteContract({
  name: 'mcp.getNpmRegistryStatus',
  input: z.object({}),
  output: z.object({
    status: NpmRegistryStatusSchema
  })
})

export const mcpRefreshNpmRegistryRoute = defineRouteContract({
  name: 'mcp.refreshNpmRegistry',
  input: z.object({}),
  output: z.object({
    registry: z.string()
  })
})

export const mcpSetCustomNpmRegistryRoute = defineRouteContract({
  name: 'mcp.setCustomNpmRegistry',
  input: z.object({
    registry: z.string().optional()
  }),
  output: z.object({
    updated: z.literal(true)
  })
})

export const mcpSetAutoDetectNpmRegistryRoute = defineRouteContract({
  name: 'mcp.setAutoDetectNpmRegistry',
  input: z.object({
    enabled: z.boolean()
  }),
  output: z.object({
    enabled: z.boolean()
  })
})

export const mcpClearNpmRegistryCacheRoute = defineRouteContract({
  name: 'mcp.clearNpmRegistryCache',
  input: z.object({}),
  output: z.object({
    cleared: z.literal(true)
  })
})
