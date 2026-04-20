import { z } from 'zod'
import type { MCPToolDefinition } from '@shared/presenter'
import { defineRouteContract } from '../common'

const MCPToolDefinitionSchema = z.custom<MCPToolDefinition>()

export const toolsListDefinitionsRoute = defineRouteContract({
  name: 'tools.listDefinitions',
  input: z.object({
    enabledMcpTools: z.array(z.string()).optional(),
    disabledAgentTools: z.array(z.string()).optional(),
    chatMode: z.enum(['agent', 'acp agent']).optional(),
    supportsVision: z.boolean().optional(),
    agentWorkspacePath: z.string().nullable().optional(),
    conversationId: z.string().optional()
  }),
  output: z.object({
    tools: z.array(MCPToolDefinitionSchema)
  })
})
