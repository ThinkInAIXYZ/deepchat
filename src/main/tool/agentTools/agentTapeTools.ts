import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import type { MCPToolDefinition } from '@shared/types/mcp'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import type { AgentTapeToolPort, AgentToolSessionPort } from '../runtimePorts'
import { TAPE_TOOL_NAMES, getAgentToolExposure, isTapeToolName } from '@shared/agentTools'
import type { AgentTapeSearchResult } from '@shared/types/agent-interface'
import type { AgentToolCallResult } from './agentToolManager'

export const AGENT_TAPE_TOOL_SERVER_NAME = 'agent-tape'

const tapeEntryKindSchema = z.enum(['event', 'anchor', 'message', 'tool_call', 'tool_result'])
const tapeViewScopeSchema = z.enum(['current', 'linked_subagents', 'current_and_linked'])

function isTapeSearchBoundary(value: string): boolean {
  const trimmed = value.trim()
  return Number.isFinite(Number(trimmed)) || Number.isFinite(Date.parse(trimmed))
}

const tapeSearchSchema = z.object({
  query: z.string().trim().min(1).describe('Text to search within the selected Tape view.'),
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
    .describe('Optional inclusive ISO date/time or millisecond timestamp upper bound.'),
  scope: tapeViewScopeSchema
    .optional()
    .describe(
      'Tape sources to search. Defaults to current; linked scopes include only finalized direct subagent Tapes.'
    )
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
    .describe('Maximum evidence bytes across all returned entries. Defaults to 16384.'),
  sourceSessionId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Source Tape sessionId from tape_search. Omit for the current session; linked sources must be finalized direct children.'
    )
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

function toTapeSearchOverview(result: AgentTapeSearchResult): AgentTapeSearchResult {
  return {
    sessionId: result.sessionId,
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
  constructor(
    private readonly sessions: AgentToolSessionPort,
    private readonly tape: AgentTapeToolPort
  ) {}

  isModelTool(toolName: string): toolName is RecallTapeToolName {
    return (
      hasRecallToolSchema(toolName) &&
      isTapeToolName(toolName) &&
      getAgentToolExposure(toolName) === 'system-model'
    )
  }

  async canUse(conversationId?: string): Promise<boolean> {
    const normalizedConversationId = conversationId?.trim()
    if (!normalizedConversationId) return false
    if (
      typeof this.tape.searchTape !== 'function' ||
      typeof this.tape.getTapeContext !== 'function'
    ) {
      return false
    }

    const session = await this.sessions.resolveConversationSessionInfo(normalizedConversationId)
    return session?.agentType === 'deepchat'
  }

  getToolDefinitions(): MCPToolDefinition[] {
    return [
      buildToolDefinition(
        TAPE_TOOL_NAMES.search,
        'Search the current DeepChat Tape or finalized direct subagent Tapes. Results are compact, source-qualified, and bounded by each linked Tape snapshot.',
        tapeSearchSchema
      ),
      buildToolDefinition(
        TAPE_TOOL_NAMES.context,
        'Expand compact local evidence around selected Tape entry IDs within exactly one current or linked source without returning unbounded raw payloads.',
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
      const args = tapeToolSchemas[toolName].parse(rawArgs)
      const results = await this.tape.searchTape(normalizedConversationId, args.query, {
        limit: args.limit,
        kinds: args.kinds,
        start: args.start,
        end: args.end,
        ...(args.scope === undefined ? {} : { scope: args.scope })
      })
      const overview = results.map(toTapeSearchOverview)
      return createTapeResult(toolName, overview, `Found ${overview.length} tape entries.`)
    }

    const args = tapeToolSchemas[toolName].parse(rawArgs)
    const context = await this.tape.getTapeContext(normalizedConversationId, args.entryIds, {
      before: args.before,
      after: args.after,
      limit: args.limit,
      maxBytesPerEntry: args.maxBytesPerEntry,
      maxTotalBytes: args.maxTotalBytes,
      ...(args.sourceSessionId === undefined ? {} : { sourceSessionId: args.sourceSessionId })
    })
    return createTapeResult(
      toolName,
      context,
      `Expanded ${context.entries.length} tape context entries.`
    )
  }
}
