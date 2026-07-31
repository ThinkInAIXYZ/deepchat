import { z } from 'zod'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { JsonValueSchema } from '@shared/contracts/common'
import { WORKFLOW_AGENT_TOOL_NAME } from '@shared/agentTools'
import {
  WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES,
  WorkflowRuntimeLimitsSchema
} from '@shared/workflow/runtimeProtocol'
import { WorkflowRunBudgetSchema } from '@shared/workflow/serviceContracts'
import type { AgentWorkflowToolPort } from '../runtimePorts'
import type { AgentToolCallResult } from './agentToolManager'

export { WORKFLOW_AGENT_TOOL_NAME } from '@shared/agentTools'

const WorkflowToolIdSchema = z.string().trim().min(1).max(256)
const WorkflowRuntimeLimitOverridesSchema = z
  .object(WorkflowRuntimeLimitsSchema.shape)
  .partial()
  .strict()

export const workflowAgentToolSchema = z
  .object({
    operation: z.enum(['prepare_launch', 'launch', 'list', 'inspect', 'cancel', 'resume', 'retry']),
    scriptSource: z.string().min(1).max(WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES).optional(),
    input: JsonValueSchema.optional(),
    parentMessageId: WorkflowToolIdSchema.nullable().optional(),
    namedWorkflowPath: z
      .string()
      .trim()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes('\0'), 'Workflow path cannot contain NUL')
      .nullable()
      .optional(),
    allowedAgentIds: z.array(WorkflowToolIdSchema).min(1).max(32).optional(),
    limits: WorkflowRuntimeLimitOverridesSchema.optional(),
    budget: WorkflowRunBudgetSchema.nullable().optional(),
    approvalId: z.string().uuid().optional(),
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
    if (value.operation === 'launch' && value.approvalId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['approvalId'],
        message: 'approvalId is required for launch.'
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
          'Prepare and explicitly manage durable JavaScript workflows that coordinate DeepChat child agents. Use only when the user explicitly asks for workflow orchestration. Call prepare_launch first, show its exact approval summary, and call launch only after the user approves. Use status operations to inspect or control existing runs.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['prepare_launch', 'launch', 'list', 'inspect', 'cancel', 'resume', 'retry']
            },
            scriptSource: {
              type: 'string',
              description:
                'Required for prepare_launch. Workflow JavaScript using agent, parallel, pipeline, phase, and log.'
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
              description: 'Optional maxTotalTokens and/or maxExecutionMs budget.'
            },
            approvalId: {
              type: 'string',
              description: 'Required for launch; returned by prepare_launch.'
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
        name: 'agent-workflows',
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
      case 'launch': {
        const approval = await this.workflow.getLaunchApproval(
          conversationId,
          requireValue(args.approvalId, 'approvalId')
        )
        const targetAgents = approval.summary.allowedAgentIds.join(', ')
        const workspace = approval.summary.workspacePath ?? 'none'
        return [
          `Launch workflow ${approval.sourceHash.slice(0, 12)}.`,
          `Workspace: ${workspace}.`,
          `Allowed agents: ${targetAgents}.`,
          `Maximum invocations: ${approval.summary.maxInvocations}.`,
          `Capabilities: ${approval.summary.capabilities.join(', ')}.`
        ].join(' ')
      }
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
        return {
          approval: await this.workflow.prepareLaunch(parentSessionId, {
            scriptSource: requireValue(args.scriptSource, 'scriptSource'),
            input: args.input ?? null,
            parentMessageId: args.parentMessageId,
            namedWorkflowPath: args.namedWorkflowPath,
            allowedAgentIds: args.allowedAgentIds,
            limits: args.limits,
            budget: args.budget
          }),
          nextAction:
            'Show this exact approval summary to the user. Call operation=launch only after explicit approval.'
        }
      case 'launch':
        return {
          run: await this.workflow.launch(
            parentSessionId,
            requireValue(args.approvalId, 'approvalId')
          )
        }
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
