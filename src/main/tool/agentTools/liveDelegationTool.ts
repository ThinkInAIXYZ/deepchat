import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import {
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import {
  DEEPCHAT_SUBAGENT_MODEL_GUIDANCE,
  DEEPCHAT_SUBAGENT_TASK_TITLE_LIMIT
} from '@shared/lib/deepchatSubagents'
import {
  LIVE_DELEGATION_OPERATIONS,
  LIVE_DELEGATION_MAX_MESSAGE_BYTES,
  LIVE_DELEGATION_MAX_PROMPT_BYTES,
  LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH,
  LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS
} from '@shared/orchestration/liveDelegation'
import { createChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'
import type {
  DeepChatSubagentCapability,
  DeepChatSubagentSlot
} from '@shared/types/agent-interface'
import type { AgentToolCallResult } from './agentToolManager'
import type { AgentLiveDelegationToolPort, LiveDelegationStartAuthorization } from '../runtimePorts'

const liveDelegationSchema = z
  .object({
    operation: z.enum(LIVE_DELEGATION_OPERATIONS),
    slotId: z.string().trim().min(1).max(256).optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(DEEPCHAT_SUBAGENT_TASK_TITLE_LIMIT)
      .refine((value) => !hasControlCharacters(value), {
        message: 'Task title cannot contain control characters.'
      })
      .optional(),
    prompt: utf8BoundedString(LIVE_DELEGATION_MAX_PROMPT_BYTES, 'Prompt').optional(),
    delegationId: z.string().trim().min(1).max(256).optional(),
    turnId: z.string().trim().min(1).max(256).optional(),
    cursor: z.string().trim().min(1).max(LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH).optional(),
    maxTokens: z.number().int().min(1).max(LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS).optional(),
    message: utf8BoundedString(LIVE_DELEGATION_MAX_MESSAGE_BYTES, 'Message').optional(),
    task: utf8BoundedString(LIVE_DELEGATION_MAX_PROMPT_BYTES, 'Task').optional(),
    delegationIds: z.array(z.string().trim().min(1).max(256)).max(20).optional(),
    after: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().min(0).max(60_000).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const required: Partial<Record<(typeof value)['operation'], Array<keyof typeof value>>> = {
      spawn: ['slotId', 'title', 'prompt'],
      send: ['delegationId', 'message'],
      follow_up: ['delegationId', 'task'],
      inspect: ['delegationId'],
      read_result: ['delegationId'],
      interrupt: ['delegationId']
    }
    for (const key of required[value.operation] ?? []) {
      if (value[key] == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${String(key)} is required when operation is ${value.operation}.`
        })
      }
    }
  })

export class LiveDelegationAgentTool {
  constructor(private readonly service: AgentLiveDelegationToolPort) {}

  getToolDefinition(capability?: DeepChatSubagentCapability): MCPToolDefinition | null {
    if (!capability?.available) return null
    return {
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: LIVE_DELEGATION_AGENT_TOOL_NAME,
        description: [
          'Control persistent direct-child Sessions for adaptive multi-Agent collaboration.',
          DEEPCHAT_SUBAGENT_MODEL_GUIDANCE,
          'Use spawn for one bounded task, send to leave a message without starting a turn,',
          'follow_up to start a later child turn, wait for bounded completion mailbox events,',
          'use list or inspect instead of wait to check permission or question states,',
          'read_result to page through a referenced complete child answer when its Handoff is',
          'insufficient,',
          'and interrupt only for explicit cancellation or definitively superseded work, never',
          'merely to avoid waiting.'
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [...LIVE_DELEGATION_OPERATIONS]
            },
            slotId: buildSlotIdParameter(capability.slots),
            title: {
              type: 'string',
              maxLength: DEEPCHAT_SUBAGENT_TASK_TITLE_LIMIT,
              description:
                'Concise user-language action-and-scope title for operation=spawn. Keep sibling titles distinct; do not use a role, ordinal, or person name.'
            },
            prompt: {
              type: 'string',
              description:
                'Bounded child task for operation=spawn. State evidence and output needs.'
            },
            delegationId: {
              type: 'string',
              description:
                'Stable delegation ID for send, follow_up, inspect, read_result, or interrupt.'
            },
            turnId: {
              type: 'string',
              description:
                'Optional terminal turn ID for read_result. Omit to read the latest turn.'
            },
            cursor: {
              type: 'string',
              maxLength: LIVE_DELEGATION_RESULT_CURSOR_MAX_LENGTH,
              description:
                'Opaque nextCursor from an earlier read_result page. Do not construct it.'
            },
            maxTokens: {
              type: 'number',
              minimum: 1,
              maximum: LIVE_DELEGATION_RESULT_PAGE_MAX_TOKENS,
              description: 'Approximate read_result page budget. Defaults to 2000 tokens.'
            },
            message: {
              type: 'string',
              description:
                'Message stored for the child without starting a turn. A later follow_up consumes it.'
            },
            task: {
              type: 'string',
              description: 'Task that starts a new turn in a non-generating child Session.'
            },
            delegationIds: {
              type: 'array',
              maxItems: 20,
              items: { type: 'string' },
              description: 'Optional wait filter. Omit to receive updates for every direct child.'
            },
            after: {
              type: 'number',
              minimum: 0,
              description: 'Mailbox cursor returned by an earlier wait. Defaults to 0.'
            },
            timeoutMs: {
              type: 'number',
              minimum: 0,
              maximum: 60_000,
              description: 'Bounded wait duration. Defaults to 30000.'
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              description: 'Maximum list results. Defaults to 20.'
            }
          },
          required: ['operation']
        }
      },
      server: {
        name: LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME,
        icons: '⑂',
        description: 'DeepChat persistent live Subagents'
      }
    }
  }

  async call(
    rawArgs: Record<string, unknown>,
    conversationId: string | undefined,
    options?: {
      signal?: AbortSignal
      liveDelegationAuthorization?: LiveDelegationStartAuthorization
      beforeMutation?: (normalizedArguments: Record<string, unknown>) => void
    }
  ): Promise<AgentToolCallResult> {
    if (!conversationId)
      throw new Error(`${LIVE_DELEGATION_AGENT_TOOL_NAME} requires a conversationId.`)
    const args = liveDelegationSchema.parse(rawArgs)
    const beforeMutation = options?.beforeMutation
      ? () => options.beforeMutation?.(args)
      : undefined
    let result: unknown
    switch (args.operation) {
      case 'spawn': {
        const input = {
          slotId: args.slotId!,
          title: args.title!,
          prompt: args.prompt!
        }
        result = beforeMutation
          ? await this.service.spawn(
              conversationId,
              input,
              options?.liveDelegationAuthorization,
              beforeMutation
            )
          : await this.service.spawn(conversationId, input, options?.liveDelegationAuthorization)
        break
      }
      case 'send':
        result = beforeMutation
          ? this.service.send(conversationId, args.delegationId!, args.message!, beforeMutation)
          : this.service.send(conversationId, args.delegationId!, args.message!)
        break
      case 'follow_up':
        result = beforeMutation
          ? await this.service.followUp(
              conversationId,
              args.delegationId!,
              args.task!,
              options?.liveDelegationAuthorization,
              beforeMutation
            )
          : await this.service.followUp(
              conversationId,
              args.delegationId!,
              args.task!,
              options?.liveDelegationAuthorization
            )
        break
      case 'list':
        result = this.service.list(conversationId, args.limit)
        break
      case 'inspect':
        result = this.service.inspect(conversationId, args.delegationId!)
        break
      case 'read_result':
        result = await this.service.readResult(conversationId, args.delegationId!, {
          ...(args.turnId === undefined ? {} : { turnId: args.turnId }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.maxTokens === undefined ? {} : { maxTokens: args.maxTokens })
        })
        break
      case 'wait':
        result = await this.service.wait(conversationId, {
          ...(args.after === undefined ? {} : { after: args.after }),
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
          ...(args.delegationIds === undefined ? {} : { delegationIds: args.delegationIds }),
          ...(options?.signal ? { signal: options.signal } : {})
        })
        break
      case 'interrupt':
        result = beforeMutation
          ? await this.service.interrupt(conversationId, args.delegationId!, beforeMutation)
          : await this.service.interrupt(conversationId, args.delegationId!)
        break
    }
    const content = JSON.stringify(createChildAgentResultEnvelope(args.operation, result))
    return {
      content,
      rawData: { content, isError: false, toolResult: result }
    }
  }
}

function buildSlotIdParameter(slots: DeepChatSubagentSlot[]) {
  return {
    type: 'string',
    enum: slots.map((slot) => slot.id),
    description: [
      'Configured child role for operation=spawn.',
      ...slots.map(
        (slot) =>
          `${slot.id}: ${slot.displayName || slot.id}${slot.description ? ` — ${slot.description}` : ''}`
      )
    ].join('\n')
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }
  return false
}

function utf8BoundedString(maxBytes: number, label: string) {
  return z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= maxBytes, {
      message: `${label} must not exceed ${maxBytes} UTF-8 bytes or contain NUL characters.`
    })
}
