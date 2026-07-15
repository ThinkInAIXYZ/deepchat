import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import type { MCPToolDefinition } from '@shared/presenter'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import { TAPE_TOOL_NAMES, getAgentToolExposure, isTapeToolName } from '@shared/agentTools'
import type { AgentToolRuntimePort } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export const AGENT_TAPE_TOOL_SERVER_NAME = 'agent-tape'

const tapeEntryKindSchema = z.enum(['event', 'anchor', 'message', 'tool_call', 'tool_result'])

function isTapeSearchBoundary(value: string): boolean {
  const trimmed = value.trim()
  return Number.isFinite(Number(trimmed)) || Number.isFinite(Date.parse(trimmed))
}

const tapeSearchSchema = z.object({
  query: z.string().trim().min(1).describe('Text to search within this session tape.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of matching tape entries to return. Defaults to 20.'),
  kinds: z
    .array(tapeEntryKindSchema)
    .optional()
    .describe('Optional entry kind filter for this session tape search.'),
  start: z
    .string()
    .trim()
    .min(1)
    .refine(isTapeSearchBoundary, 'Expected an ISO date/time or millisecond timestamp.')
    .optional()
    .describe('Optional inclusive ISO date/time or millisecond timestamp lower bound.'),
  end: z
    .string()
    .trim()
    .min(1)
    .refine(isTapeSearchBoundary, 'Expected an ISO date/time or millisecond timestamp.')
    .optional()
    .describe('Optional inclusive ISO date/time or millisecond timestamp upper bound.')
})

const tapeContextSchema = z.object({
  entryIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(20)
    .describe('Tape entry IDs to expand into compact local context.'),
  before: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe(
      'Number of effective tape entries to include before each requested entry. Defaults to 2.'
    ),
  after: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe(
      'Number of effective tape entries to include after each requested entry. Defaults to 2.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum compact context entries to return. Defaults to 50.'),
  maxBytesPerEntry: z
    .number()
    .int()
    .min(0)
    .max(8192)
    .optional()
    .describe('Maximum evidence bytes per entry. Defaults to 2048.'),
  maxTotalBytes: z
    .number()
    .int()
    .min(0)
    .max(65536)
    .optional()
    .describe('Maximum evidence bytes across all returned entries. Defaults to 16384.')
})

const tapeToolSchemas = {
  [TAPE_TOOL_NAMES.search]: tapeSearchSchema,
  [TAPE_TOOL_NAMES.context]: tapeContextSchema
}

type RecallTapeToolName = typeof TAPE_TOOL_NAMES.search | typeof TAPE_TOOL_NAMES.context

function hasRecallToolSchema(toolName: string): toolName is RecallTapeToolName {
  return Object.prototype.hasOwnProperty.call(tapeToolSchemas, toolName)
}

function buildToolDefinition(
  name: RecallTapeToolName,
  description: string,
  schema: z.ZodTypeAny
): MCPToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: toDeepChatJsonSchema(schema) as {
        type: string
        properties: Record<string, unknown>
        required?: string[]
      }
    },
    server: {
      name: AGENT_TAPE_TOOL_SERVER_NAME,
      icons: 'T',
      description: 'DeepChat session tape tools'
    }
  }
}

function createTapeResult(
  toolName: RecallTapeToolName,
  result: unknown,
  summary: string
): AgentToolCallResult {
  const content = JSON.stringify(result, null, 2)
  return {
    content,
    rawData: {
      content,
      isError: false,
      toolResult: createAgentToolSuccessResult(toolName, result, {
        summary,
        data: result
      })
    }
  }
}

function toTapeSearchOverview(result: {
  entryId: number
  kind: string
  name: string | null
  createdAt: number
  summary?: string
  refs?: Record<string, unknown>
  score?: number
}): {
  entryId: number
  kind: string
  name: string | null
  createdAt: number
  summary?: string
  refs?: Record<string, unknown>
  score?: number
} {
  return {
    entryId: result.entryId,
    kind: result.kind,
    name: result.name,
    createdAt: result.createdAt,
    ...(result.summary === undefined ? {} : { summary: result.summary }),
    ...(result.refs === undefined ? {} : { refs: result.refs }),
    ...(result.score === undefined ? {} : { score: result.score })
  }
}

export class AgentTapeToolHandler {
  constructor(private readonly runtimePort: AgentToolRuntimePort) {}

  isModelTool(toolName: string): toolName is RecallTapeToolName {
    return (
      hasRecallToolSchema(toolName) &&
      isTapeToolName(toolName) &&
      getAgentToolExposure(toolName) === 'system-model'
    )
  }

  async canUse(conversationId?: string): Promise<boolean> {
    const normalizedConversationId = conversationId?.trim()
    if (
      !normalizedConversationId ||
      !this.runtimePort.searchTape ||
      !this.runtimePort.getTapeContext
    ) {
      return false
    }

    const session = await this.runtimePort.resolveConversationSessionInfo(normalizedConversationId)
    return session?.agentType === 'deepchat'
  }

  getToolDefinitions(): MCPToolDefinition[] {
    return [
      buildToolDefinition(
        TAPE_TOOL_NAMES.search,
        'Search this DeepChat-scoped append-only tape subset inspired by bub tape.search. Supports text query plus optional kind and created-at filters for the current session.',
        tapeSearchSchema
      ),
      buildToolDefinition(
        TAPE_TOOL_NAMES.context,
        'Expand compact local evidence around selected tape entry IDs for the current session without returning unbounded raw payloads.',
        tapeContextSchema
      )
    ]
  }

  async call(
    toolName: string,
    rawArgs: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    if (!this.isModelTool(toolName)) {
      throw new Error(`Tape tool '${toolName}' is not available to the model.`)
    }
    const normalizedConversationId = conversationId?.trim()
    if (!normalizedConversationId) {
      throw new Error(`${toolName} requires a conversation ID.`)
    }
    if (!(await this.canUse(normalizedConversationId))) {
      throw new Error('Tape recall tools are not available for this conversation.')
    }

    if (toolName === TAPE_TOOL_NAMES.search) {
      if (!this.runtimePort.searchTape) {
        throw new Error('Tape search is not available.')
      }
      const args = tapeToolSchemas[toolName].parse(rawArgs)
      const results = await this.runtimePort.searchTape(normalizedConversationId, args.query, {
        limit: args.limit,
        kinds: args.kinds,
        start: args.start,
        end: args.end
      })
      const overview = results.map(toTapeSearchOverview)
      return createTapeResult(toolName, overview, `Found ${overview.length} tape entries.`)
    }

    if (!this.runtimePort.getTapeContext) {
      throw new Error('Tape context is not available.')
    }
    const args = tapeToolSchemas[toolName].parse(rawArgs)
    const context = await this.runtimePort.getTapeContext(normalizedConversationId, args.entryIds, {
      before: args.before,
      after: args.after,
      limit: args.limit,
      maxBytesPerEntry: args.maxBytesPerEntry,
      maxTotalBytes: args.maxTotalBytes
    })
    return createTapeResult(
      toolName,
      context,
      `Expanded ${context.entries.length} tape context entries.`
    )
  }
}
