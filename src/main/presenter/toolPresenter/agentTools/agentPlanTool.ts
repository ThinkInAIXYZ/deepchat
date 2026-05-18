import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { MCPToolDefinition } from '@shared/presenter'
import type { AgentToolProgressUpdate } from '@shared/types/presenters/tool.presenter'
import type { AgentPlanState, AgentPlanSnapshot, UpdatePlanArgs } from '@shared/types/agent-plan'

export const UPDATE_PLAN_TOOL_NAME = 'update_plan'
export const AGENT_CORE_TOOL_SERVER_NAME = 'agent-core'

const MAX_PLAN_ITEMS = 12

const planItemSchema = z
  .object({
    step: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, 'step must be a non-empty string'),
    status: z.enum(['pending', 'in_progress', 'completed'])
  })
  .strict()

export const updatePlanToolArgsSchema = z
  .object({
    explanation: z.string().optional(),
    plan: z.array(planItemSchema).max(MAX_PLAN_ITEMS)
  })
  .strict()
  .superRefine((value, context) => {
    const inProgressCount = value.plan.filter((item) => item.status === 'in_progress').length
    if (inProgressCount > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'at most one step can be in_progress'
      })
    }
  })

export interface AgentPlanToolCallOptions {
  toolCallId?: string
  onProgress?: (update: AgentToolProgressUpdate) => void
}

const formatValidationError = (error: z.ZodError): string => {
  const firstIssue = error.issues[0]
  if (!firstIssue) {
    return 'invalid update_plan arguments'
  }

  const path = firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : ''
  return `invalid update_plan arguments: ${path}${firstIssue.message}`
}

export class AgentPlanTool {
  private readonly states = new Map<string, AgentPlanState>()

  getToolDefinition(): MCPToolDefinition {
    return {
      type: 'function',
      function: {
        name: UPDATE_PLAN_TOOL_NAME,
        description:
          'Update the visible progress checklist for the current multi-step task. Provide the complete current plan snapshot every time. Use short, concrete, verifiable steps. At most one step may be in_progress.',
        parameters: zodToJsonSchema(updatePlanToolArgsSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: AGENT_CORE_TOOL_SERVER_NAME,
        icons: 'list-checks',
        description: 'Agent core tools'
      }
    }
  }

  call(
    args: Record<string, unknown>,
    conversationId?: string,
    options?: AgentPlanToolCallOptions
  ): { content: string; rawData: { content: string; isError: boolean; toolResult: unknown } } {
    const sessionId = conversationId?.trim()
    if (!sessionId) {
      throw new Error('update_plan requires a conversation ID')
    }

    const validationResult = updatePlanToolArgsSchema.safeParse(args)
    if (!validationResult.success) {
      throw new Error(formatValidationError(validationResult.error))
    }

    const normalizedArgs = this.normalizeArgs(validationResult.data)
    const previous = this.states.get(sessionId)
    const revision = (previous?.revision ?? 0) + 1
    const updatedAt = new Date().toISOString()
    const toolCallId = options?.toolCallId?.trim() || undefined
    const snapshot: AgentPlanSnapshot = {
      sessionId,
      ...(toolCallId ? { toolCallId } : {}),
      ...(normalizedArgs.explanation ? { explanation: normalizedArgs.explanation } : {}),
      plan: normalizedArgs.plan,
      revision,
      updatedAt
    }

    this.states.set(sessionId, {
      current: normalizedArgs,
      revision,
      updatedAt
    })

    if (toolCallId) {
      options?.onProgress?.({
        kind: 'agent_plan',
        toolCallId,
        snapshot
      })
    }

    return {
      content: '{}',
      rawData: {
        content: '{}',
        isError: false,
        toolResult: {
          kind: 'agent_plan',
          snapshot
        }
      }
    }
  }

  getState(conversationId: string): AgentPlanState {
    return (
      this.states.get(conversationId) ?? {
        current: null,
        revision: 0,
        updatedAt: null
      }
    )
  }

  clearState(conversationId: string): void {
    this.states.delete(conversationId)
  }

  private normalizeArgs(args: z.output<typeof updatePlanToolArgsSchema>): UpdatePlanArgs {
    const explanation = args.explanation?.trim()
    return {
      ...(explanation ? { explanation } : {}),
      plan: args.plan.map((item) => ({
        step: item.step,
        status: item.status
      }))
    }
  }
}
