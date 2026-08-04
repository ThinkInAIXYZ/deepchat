import { z } from 'zod'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { JsonValueSchema } from '@shared/contracts/common'
import { WORKFLOW_AGENT_TOOL_NAME, WORKFLOW_AGENT_TOOL_SERVER_NAME } from '@shared/agentTools'
import { WORKFLOW_AUTHORING_GUIDE } from '@shared/workflow/authoringContract'
import {
  WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES,
  WorkflowRuntimeLimitsSchema
} from '@shared/workflow/runtimeProtocol'
import {
  WorkflowPrepareLaunchToolResultSchema,
  WorkflowRunBudgetSchema
} from '@shared/workflow/serviceContracts'
import type { AgentWorkflowToolPort } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export { WORKFLOW_AGENT_TOOL_NAME } from '@shared/agentTools'

const WorkflowToolIdSchema = z.string().trim().min(1).max(256)
const WorkflowScriptSourceSchema = z
  .string()
  .min(1)
  .max(WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES,
    `Workflow source must not exceed ${WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES} UTF-8 bytes.`
  )
const WorkflowRuntimeLimitOverridesSchema = z
  .object(WorkflowRuntimeLimitsSchema.shape)
  .partial()
  .strict()

export const workflowAgentToolSchema = z
  .object({
    operation: z.enum(['prepare_launch', 'list', 'inspect', 'cancel', 'resume', 'retry']),
    scriptSource: WorkflowScriptSourceSchema.optional(),
    input: JsonValueSchema.optional(),
    parentMessageId: WorkflowToolIdSchema.nullable().optional(),
    allowedAgentIds: z.array(WorkflowToolIdSchema).min(1).max(32).optional(),
    limits: WorkflowRuntimeLimitOverridesSchema.optional(),
    budget: WorkflowRunBudgetSchema.nullable().optional(),
    runId: WorkflowToolIdSchema.optional(),
    invocationId: WorkflowToolIdSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    reason: z.string().trim().min(1).max(8_192).optional(),
    fromHere: z.boolean().optional(),
    confirmEffects: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === 'prepare_launch' && value.scriptSource === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['scriptSource'],
        message: 'scriptSource is required for prepare_launch.'
      })
    }
    if (
      ['inspect', 'cancel', 'resume', 'retry'].includes(value.operation) &&
      value.runId === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: `runId is required for ${value.operation}.`
      })
    }
    if (value.operation === 'retry' && value.invocationId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['invocationId'],
        message: 'invocationId is required for retry.'
      })
    }
  })

type WorkflowAgentToolArgs = z.infer<typeof workflowAgentToolSchema>

export class WorkflowAgentTool {
  constructor(private readonly workflow: AgentWorkflowToolPort) {}

  async canUse(conversationId: string | undefined): Promise<boolean> {
    return Boolean(conversationId && (await this.workflow.canUse(conversationId)))
  }

  getToolDefinition(): MCPToolDefinition {
    return {
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: WORKFLOW_AGENT_TOOL_NAME,
        description:
          'Prepare and manage durable JavaScript workflows that coordinate DeepChat child agents. Choose this executor for large fan-out, programmatic data flow, recovery, or reusable orchestration when allowed by the current orchestration policy. Call prepare_launch and let the native approval card launch the exact approved snapshot; do not call launch yourself. Use status operations to inspect or control existing runs.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['prepare_launch', 'list', 'inspect', 'cancel', 'resume', 'retry']
            },
            scriptSource: {
              type: 'string',
              description: `Required for prepare_launch.\n${WORKFLOW_AUTHORING_GUIDE}`
            },
            input: {
              description: 'Optional bounded JSON input exposed to the workflow as input.'
            },
            parentMessageId: {
              type: ['string', 'null'],
              description: 'Optional parent message identity used as workflow provenance.'
            },
            allowedAgentIds: {
              type: 'array',
              minItems: 1,
              maxItems: 32,
              items: { type: 'string' },
              description:
                'Exact DeepChat agent allowlist. Defaults to the current parent agent only.'
            },
            limits: {
              type: 'object',
              description: 'Optional runtime limit overrides.'
            },
            budget: {
              type: ['object', 'null'],
              properties: {
                maxExecutionMs: {
                  type: 'integer',
                  minimum: 1_000,
                  maximum: 7 * 24 * 60 * 60 * 1_000,
                  description: 'Host-owned execution deadline in milliseconds.'
                }
              },
              required: ['maxExecutionMs'],
              additionalProperties: false,
              description:
                'Optional host-owned execution deadline. Omit budget to use the two-hour default.'
            },
            runId: {
              type: 'string',
              description: 'Required for inspect, cancel, resume, and retry.'
            },
            invocationId: {
              type: 'string',
              description: 'Required for retry.'
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              description: 'Maximum runs returned by list.'
            },
            reason: {
              type: 'string',
              description: 'Optional cancellation reason.'
            },
            fromHere: {
              type: 'boolean',
              description: 'Retry this invocation and invalidate all later audit-sequence work.'
            },
            confirmEffects: {
              type: 'boolean',
              description:
                'Confirm that retry may repeat work with recorded write or unknown effects.'
            }
          },
          required: ['operation']
        }
      },
      server: {
        name: WORKFLOW_AGENT_TOOL_SERVER_NAME,
        icons: '🔀',
        description: 'Durable DeepChat workflows'
      }
    }
  }

  async call(
    rawArgs: Record<string, unknown>,
    conversationId: string | undefined,
    options?: { signal?: AbortSignal }
  ): Promise<AgentToolCallResult> {
    if (!conversationId) {
      throw new Error('workflow requires a conversationId.')
    }
    options?.signal?.throwIfAborted()
    const args = workflowAgentToolSchema.parse(rawArgs)
    if (!(await this.workflow.canUse(conversationId))) {
      throw new Error('workflow is unavailable for the current session.')
    }
    options?.signal?.throwIfAborted()

    const result = await this.execute(args, conversationId)
    const content = JSON.stringify(result)
    return {
      content,
      rawData: {
        content,
        isError: false,
        toolResult: result
      }
    }
  }

  async getMutationPermissionDescription(
    rawArgs: Record<string, unknown>,
    conversationId: string | undefined
  ): Promise<string | null> {
    if (!conversationId) {
      return null
    }
    const args = workflowAgentToolSchema.parse(rawArgs)
    switch (args.operation) {
      case 'cancel':
        return `Cancel workflow run ${requireValue(args.runId, 'runId')}.`
      case 'resume':
        return `Resume workflow run ${requireValue(args.runId, 'runId')}; unfinished child work may execute.`
      case 'retry':
        return `Retry workflow invocation ${requireValue(args.invocationId, 'invocationId')} in run ${requireValue(args.runId, 'runId')}${args.fromHere ? ' and invalidate later invocations' : ''}${args.confirmEffects ? '; recorded write or unknown effects may be repeated' : ''}.`
      default:
        return null
    }
  }

  private async execute(args: WorkflowAgentToolArgs, parentSessionId: string): Promise<unknown> {
    switch (args.operation) {
      case 'prepare_launch':
        return WorkflowPrepareLaunchToolResultSchema.parse({
          approval: await this.workflow.prepareLaunch(parentSessionId, {
            scriptSource: requireValue(args.scriptSource, 'scriptSource'),
            input: args.input ?? null,
            parentMessageId: args.parentMessageId,
            allowedAgentIds: args.allowedAgentIds,
            limits: args.limits,
            budget: args.budget
          }),
          nextAction:
            'The native approval card owns explicit user approval and exact-ID launch. Do not call operation=launch.'
        })
      case 'list':
        return {
          runs: await this.workflow.list(parentSessionId, args.limit)
        }
      case 'inspect':
        return {
          run: await this.workflow.inspect(parentSessionId, requireValue(args.runId, 'runId'))
        }
      case 'cancel':
        return {
          run: await this.workflow.cancel(
            parentSessionId,
            requireValue(args.runId, 'runId'),
            args.reason
          )
        }
      case 'resume':
        return {
          run: await this.workflow.resume(parentSessionId, requireValue(args.runId, 'runId'))
        }
      case 'retry':
        return {
          run: await this.workflow.retry(parentSessionId, {
            runId: requireValue(args.runId, 'runId'),
            invocationId: requireValue(args.invocationId, 'invocationId'),
            fromHere: args.fromHere,
            confirmEffects: args.confirmEffects
          })
        }
    }
  }
}

function requireValue<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`${field} is required.`)
  }
  return value
}
