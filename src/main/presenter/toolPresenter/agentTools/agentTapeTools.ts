import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import type { MCPToolDefinition } from '@shared/presenter'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import type { AgentToolRuntimePort } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export const AGENT_TAPE_TOOL_SERVER_NAME = 'agent-tape'
export const TAPE_TOOL_NAMES = {
  info: 'tape_info',
  search: 'tape_search',
  context: 'tape_context',
  anchors: 'tape_anchors',
  handoff: 'tape_handoff'
} as const

const tapeInfoSchema = z.object({})

const tapeAnchorsSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum number of recent anchors to return. Defaults to 20.')
})

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

const tapeHandoffSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Handoff name. Values without a prefix are normalized to handoff/<name>.'),
  summary: z
    .string()
    .trim()
    .optional()
    .default('')
    .describe('Compact durable summary for the handoff anchor.')
})

const tapeToolSchemas = {
  [TAPE_TOOL_NAMES.info]: tapeInfoSchema,
  [TAPE_TOOL_NAMES.search]: tapeSearchSchema,
  [TAPE_TOOL_NAMES.context]: tapeContextSchema,
  [TAPE_TOOL_NAMES.anchors]: tapeAnchorsSchema,
  [TAPE_TOOL_NAMES.handoff]: tapeHandoffSchema
}

type TapeToolName = (typeof TAPE_TOOL_NAMES)[keyof typeof TAPE_TOOL_NAMES]

type TapeAnchorOverview = {
  name: string | null
  entryId: number
  createdAt: number
}

function buildToolDefinition(
  name: TapeToolName,
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
  toolName: TapeToolName,
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

function toTapeAnchorOverview(anchor: {
  name: string | null
  entryId: number
  createdAt: number
}): TapeAnchorOverview {
  return {
    name: anchor.name,
    entryId: anchor.entryId,
    createdAt: anchor.createdAt
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

function parseTapeHandoffArgs(rawArgs: Record<string, unknown>): z.infer<typeof tapeHandoffSchema> {
  const parsed = tapeHandoffSchema.safeParse(rawArgs)
  if (parsed.success) {
    return parsed.data
  }

  throw new Error(
    `Invalid arguments for ${TAPE_TOOL_NAMES.handoff}. Use only {"name"?: string, "summary"?: string}; do not pass "state" or arbitrary fields. Validation details: ${parsed.error.message}`
  )
}

export class AgentTapeToolHandler {
  constructor(private readonly runtimePort: AgentToolRuntimePort) {}

  isTapeTool(toolName: string): toolName is TapeToolName {
    return Object.values(TAPE_TOOL_NAMES).includes(toolName as TapeToolName)
  }

  async canUse(conversationId?: string): Promise<boolean> {
    if (
      !conversationId ||
      !this.runtimePort.getTapeInfo ||
      !this.runtimePort.searchTape ||
      !this.runtimePort.listTapeAnchors ||
      !this.runtimePort.handoffTape
    ) {
      return false
    }

    const session = await this.runtimePort.resolveConversationSessionInfo(conversationId)
    return session?.agentType === 'deepchat'
  }

  getToolDefinitions(): MCPToolDefinition[] {
    const definitions = [
      buildToolDefinition(
        TAPE_TOOL_NAMES.info,
        'Inspect this DeepChat-scoped append-only tape subset inspired by bub tape.info. Returns entry counts, anchor state, token usage, and migration status for the current session.',
        tapeInfoSchema
      ),
      buildToolDefinition(
        TAPE_TOOL_NAMES.search,
        'Search this DeepChat-scoped append-only tape subset inspired by bub tape.search. Supports text query plus optional kind and created-at filters for the current session.',
        tapeSearchSchema
      ),
      buildToolDefinition(
        TAPE_TOOL_NAMES.anchors,
        'List recent bub-style anchors for this DeepChat session tape. Use this before handoff when you need to inspect recent phase transitions or reconstruction checkpoints.',
        tapeAnchorsSchema
      ),
      buildToolDefinition(
        TAPE_TOOL_NAMES.handoff,
        'Write a bub-style phase-transition anchor to this DeepChat session tape. The anchor becomes the durable reconstruction marker for later context builds; include a compact summary when earlier history should be carried forward.',
        tapeHandoffSchema
      )
    ]
    if (!this.runtimePort.getTapeContext) return definitions
    return [
      ...definitions.slice(0, 2),
      buildToolDefinition(
        TAPE_TOOL_NAMES.context,
        'Expand compact local evidence around selected tape entry IDs for the current session without returning unbounded raw payloads.',
        tapeContextSchema
      ),
      ...definitions.slice(2)
    ]
  }

  async call(
    toolName: string,
    rawArgs: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    if (!this.isTapeTool(toolName)) {
      throw new Error(`Unknown tape tool: ${toolName}`)
    }
    if (!conversationId) {
      throw new Error(`${toolName} requires a conversation ID.`)
    }

    if (toolName === TAPE_TOOL_NAMES.info) {
      if (!this.runtimePort.getTapeInfo) {
        throw new Error('Tape info is not available.')
      }
      tapeToolSchemas[toolName].parse(rawArgs)
      const info = await this.runtimePort.getTapeInfo(conversationId)
      return createTapeResult(toolName, info, `Tape has ${info.entries} entries.`)
    }

    if (toolName === TAPE_TOOL_NAMES.search) {
      if (!this.runtimePort.searchTape) {
        throw new Error('Tape search is not available.')
      }
      const args = tapeToolSchemas[toolName].parse(rawArgs)
      const results = await this.runtimePort.searchTape(conversationId, args.query, {
        limit: args.limit,
        kinds: args.kinds,
        start: args.start,
        end: args.end
      })
      const overview = results.map(toTapeSearchOverview)
      return createTapeResult(toolName, overview, `Found ${overview.length} tape entries.`)
    }

    if (toolName === TAPE_TOOL_NAMES.context) {
      if (!this.runtimePort.getTapeContext) {
        throw new Error('Tape context is not available.')
      }
      const args = tapeToolSchemas[toolName].parse(rawArgs)
      const context = await this.runtimePort.getTapeContext(conversationId, args.entryIds, {
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

    if (toolName === TAPE_TOOL_NAMES.anchors) {
      if (!this.runtimePort.listTapeAnchors) {
        throw new Error('Tape anchors are not available.')
      }
      const args = tapeToolSchemas[toolName].parse(rawArgs)
      const anchors = await this.runtimePort.listTapeAnchors(conversationId, {
        limit: args.limit
      })
      const overview = anchors.map(toTapeAnchorOverview)
      return createTapeResult(toolName, overview, `Found ${overview.length} tape anchors.`)
    }

    if (!this.runtimePort.handoffTape) {
      throw new Error('Tape handoff is not available.')
    }
    const args = parseTapeHandoffArgs(rawArgs)
    const handoff = await this.runtimePort.handoffTape(conversationId, args.name ?? 'manual', {
      summary: args.summary
    })
    const overview = toTapeAnchorOverview(handoff)
    return createTapeResult(
      toolName,
      overview,
      `Wrote tape handoff anchor ${overview.name ?? 'unknown'}.`
    )
  }
}
