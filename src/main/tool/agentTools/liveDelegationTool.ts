import { z } from 'zod'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import { DEEPCHAT_SUBAGENT_MODEL_GUIDANCE } from '@shared/lib/deepchatSubagents'
import type {
  DeepChatSubagentCapability,
  DeepChatSubagentSlot
} from '@shared/types/agent-interface'
import type { AgentToolCallResult } from './agentToolManager'
import type { AgentLiveDelegationToolPort } from '../runtimePorts'

const liveDelegationSchema = z
  .object({
    operation: z.enum(['spawn', 'send', 'follow_up', 'list', 'inspect', 'wait', 'interrupt']),
    slotId: z.string().trim().min(1).max(256).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    prompt: z.string().trim().min(1).max(65_536).optional(),
    delegationId: z.string().trim().min(1).max(256).optional(),
    message: z.string().trim().min(1).max(8_192).optional(),
    task: z.string().trim().min(1).max(65_536).optional(),
    delegationIds: z.array(z.string().trim().min(1).max(256)).max(20).optional(),
    after: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().min(0).max(60_000).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .superRefine((value, ctx) => {
    const required: Partial<Record<(typeof value)['operation'], Array<keyof typeof value>>> = {
      spawn: ['slotId', 'title', 'prompt'],
      send: ['delegationId', 'message'],
      follow_up: ['delegationId', 'task'],
      inspect: ['delegationId'],
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
          'and interrupt only when active work should stop. Use deepchat_workflow instead for',
          'large programmatic fan-out, reusable data flow, approval, or replay.'
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['spawn', 'send', 'follow_up', 'list', 'inspect', 'wait', 'interrupt']
            },
            slotId: buildSlotIdParameter(capability.slots),
            title: { type: 'string', description: 'Short visible label for operation=spawn.' },
            prompt: {
              type: 'string',
              description:
                'Bounded child task for operation=spawn. State evidence and output needs.'
            },
            delegationId: {
              type: 'string',
              description: 'Stable delegation ID for send, follow_up, inspect, or interrupt.'
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
        name: 'agent-live-delegation',
        icons: '⑂',
        description: 'DeepChat persistent live Subagents'
      }
    }
  }

  async call(
    rawArgs: Record<string, unknown>,
    conversationId: string | undefined,
    options?: { signal?: AbortSignal }
  ): Promise<AgentToolCallResult> {
    if (!conversationId)
      throw new Error(`${LIVE_DELEGATION_AGENT_TOOL_NAME} requires a conversationId.`)
    const args = liveDelegationSchema.parse(rawArgs)
    let result: unknown
    switch (args.operation) {
      case 'spawn':
        result = await this.service.spawn(conversationId, {
          slotId: args.slotId!,
          title: args.title!,
          prompt: args.prompt!
        })
        break
      case 'send':
        result = this.service.send(conversationId, args.delegationId!, args.message!)
        break
      case 'follow_up':
        result = await this.service.followUp(conversationId, args.delegationId!, args.task!)
        break
      case 'list':
        result = this.service.list(conversationId, args.limit)
        break
      case 'inspect':
        result = this.service.inspect(conversationId, args.delegationId!)
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
        result = await this.service.interrupt(conversationId, args.delegationId!)
        break
    }
    return {
      content: JSON.stringify(result),
      rawData: { content: JSON.stringify(result), isError: false, toolResult: result }
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
