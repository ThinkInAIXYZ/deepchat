import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { createAgentToolSuccessResult } from '@shared/lib/agentToolResultEnvelope'
import { unicodeCodePointLength } from '@shared/lib/unicodeText'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS
} from '@shared/types/agent-memory'
import type { AgentMemoryToolPort, AgentToolSessionPort } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export const AGENT_MEMORY_TOOL_SERVER_NAME = 'agent-memory'
export const MEMORY_TOOL_NAMES = {
  remember: 'memory_remember',
  recall: 'memory_recall',
  forget: 'memory_forget'
} as const

type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[keyof typeof MEMORY_TOOL_NAMES]

const rememberSchema = z.strictObject({
  content: z
    .string()
    .trim()
    .min(1)
    .refine(
      (content) => unicodeCodePointLength(content) <= AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS,
      `content must be at most ${AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS} Unicode code points`
    )
    .describe('The durable fact or event to remember long-term, written in third person.'),
  kind: z
    .enum(['semantic', 'episodic'])
    .optional()
    .default('semantic')
    .describe('semantic = stable fact/preference; episodic = a specific event.'),
  category: z
    .enum(AGENT_MEMORY_CATEGORIES)
    .optional()
    .describe('Optional agentic memory category; when provided it takes precedence over kind.'),
  importance: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.7)
    .describe('Importance 0..1 (affects retention and recall priority).')
})

const recallSchema = z.strictObject({
  query: z.string().trim().min(1).describe('What to recall; matched against stored memories.')
})

const forgetSchema = z.strictObject({
  memoryId: z.string().trim().min(1).describe('The id of the memory to forget.')
})

const memoryToolSchemas = {
  [MEMORY_TOOL_NAMES.remember]: rememberSchema,
  [MEMORY_TOOL_NAMES.recall]: recallSchema,
  [MEMORY_TOOL_NAMES.forget]: forgetSchema
}

function buildToolDefinition(
  name: MemoryToolName,
  description: string,
  schema: z.ZodTypeAny
): MCPToolDefinition {
  return {
    execution: TOOL_EXECUTION.write,
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
      name: AGENT_MEMORY_TOOL_SERVER_NAME,
      icons: '🧠',
      description: 'DeepChat long-term memory tools'
    }
  }
}

function createMemoryResult(
  toolName: MemoryToolName,
  result: unknown,
  summary: string
): AgentToolCallResult {
  const content = JSON.stringify(result, null, 2)
  return {
    content,
    rawData: {
      content,
      isError: false,
      toolResult: createAgentToolSuccessResult(toolName, result, { summary, data: result })
    }
  }
}

export class AgentMemoryToolHandler {
  constructor(
    private readonly sessions: AgentToolSessionPort,
    private readonly memory: AgentMemoryToolPort
  ) {}

  isMemoryTool(toolName: string): toolName is MemoryToolName {
    return Object.values(MEMORY_TOOL_NAMES).includes(toolName as MemoryToolName)
  }

  private async resolveAgentId(conversationId: string): Promise<string | null> {
    const session = await this.sessions.resolveConversationSessionInfo(conversationId)
    return session?.agentId?.trim() || null
  }

  async canUse(conversationId?: string): Promise<boolean> {
    if (!conversationId) return false
    const agentId = await this.resolveAgentId(conversationId)
    return Boolean(agentId && this.memory.isMemoryEnabled(agentId))
  }

  getToolDefinitions(): MCPToolDefinition[] {
    return [
      buildToolDefinition(
        MEMORY_TOOL_NAMES.remember,
        'Persist a durable long-term memory (stable fact/preference or notable event) about the user for future sessions.',
        rememberSchema
      ),
      buildToolDefinition(
        MEMORY_TOOL_NAMES.recall,
        'Recall relevant long-term memories for a query.',
        recallSchema
      ),
      buildToolDefinition(
        MEMORY_TOOL_NAMES.forget,
        'Archive a specific long-term memory by id so it is no longer recalled.',
        forgetSchema
      )
    ]
  }

  async call(
    toolName: string,
    rawArgs: Record<string, unknown>,
    conversationId?: string
  ): Promise<AgentToolCallResult> {
    if (!this.isMemoryTool(toolName)) {
      throw new Error(`Unknown memory tool: ${toolName}`)
    }
    if (!conversationId) {
      throw new Error(`${toolName} requires a conversation ID.`)
    }
    const agentId = await this.resolveAgentId(conversationId)
    if (!agentId) {
      throw new Error(`${toolName} could not resolve the current agent.`)
    }
    if (!this.memory.isMemoryEnabled(agentId)) {
      return createMemoryResult(
        toolName as MemoryToolName,
        { ok: false, reason: 'Memory is disabled for this agent.' },
        'Memory is disabled for this agent.'
      )
    }

    if (toolName === MEMORY_TOOL_NAMES.remember) {
      const args = memoryToolSchemas[toolName].parse(rawArgs)
      const session = await this.sessions.resolveConversationSessionInfo(conversationId)
      const outcome = await this.memory.rememberMemory(
        agentId,
        {
          content: args.content,
          kind: args.kind,
          category: args.category,
          importance: args.importance
        },
        conversationId,
        session ? { providerId: session.providerId, modelId: session.modelId } : null
      )
      if (outcome.action === 'noop' && outcome.reason === 'forgotten') {
        return createMemoryResult(
          toolName,
          { ok: false, action: 'noop', reason: 'requires_user_reauthorization' },
          'This matches permanently deleted memory and requires an explicit user action to restore.'
        )
      }
      const ok = outcome.action !== 'noop'
      return createMemoryResult(
        toolName,
        { ok, ...outcome },
        ok ? 'Stored or updated long-term memory.' : 'Memory write made no change.'
      )
    }

    if (toolName === MEMORY_TOOL_NAMES.recall) {
      const args = memoryToolSchemas[toolName].parse(rawArgs)
      const memories = await this.memory.recallMemory(agentId, args.query, {
        sessionId: conversationId
      })
      return createMemoryResult(toolName, { memories }, `Recalled ${memories.length} memories.`)
    }

    const args = memoryToolSchemas[MEMORY_TOOL_NAMES.forget].parse(rawArgs)
    const result = await this.memory.forgetMemory(agentId, args.memoryId)
    const ok = result.action === 'applied'
    return createMemoryResult(
      toolName,
      { ok },
      ok
        ? 'Archived the memory. It is retained locally but excluded from normal recall.'
        : result.reason === 'not-found'
          ? 'Memory not found.'
          : 'Memory could not be archived.'
    )
  }
}
