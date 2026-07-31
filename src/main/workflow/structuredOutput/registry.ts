import type { JsonValue } from '@shared/contracts/common'
import {
  TOOL_EXECUTION,
  type MCPToolCall,
  type MCPToolDefinition,
  type MCPToolResponse
} from '@shared/types/mcp'
import type { ToolCallOptions } from '@shared/types/tool'
import {
  createAgentToolErrorResult,
  createAgentToolSuccessResult
} from '@shared/lib/agentToolResultEnvelope'
import type { SessionToolProvider } from '@/tool/sessionToolProvider'
import type {
  WorkflowPreparedStructuredOutput,
  WorkflowStructuredOutputLease,
  WorkflowStructuredOutputPort
} from './contracts'
import { WorkflowStructuredOutputError } from './errors'
import { prepareWorkflowResultSchema, type PreparedWorkflowResultSchema } from './resultSchema'

export const WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME = 'workflow_submit_result'

const WORKFLOW_STRUCTURED_OUTPUT_SERVER_NAME = 'deepchat-workflow'
const MAX_OUTPUT_ATTEMPTS = 3
const MAX_FEEDBACK_LENGTH = 4_096

type OutputMode = 'tool' | 'terminal_json'
type LeaseState = 'pending' | 'resolved' | 'rejected' | 'closed'

interface DeferredResult {
  promise: Promise<JsonValue>
  resolve(value: JsonValue): void
  reject(error: unknown): void
}

export interface WorkflowStructuredOutputRegistryOptions {
  onCatalogChanged(conversationId: string): void
}

export class WorkflowStructuredOutputRegistry
  implements WorkflowStructuredOutputPort, SessionToolProvider
{
  private readonly toolLeases = new Map<string, StructuredOutputLease>()

  constructor(private readonly options: WorkflowStructuredOutputRegistryOptions) {}

  prepare(input: { schema: JsonValue; maxResultBytes: number }): WorkflowPreparedStructuredOutput {
    const preparedSchema = prepareWorkflowResultSchema(input.schema, input.maxResultBytes)
    let opened = false
    return Object.freeze({
      open: (leaseInput) => {
        if (opened) {
          throw new Error('Prepared workflow structured output can only be opened once.')
        }
        opened = true
        return this.openLease(preparedSchema, leaseInput)
      }
    })
  }

  getToolDefinitions(conversationId: string): MCPToolDefinition[] {
    const lease = this.toolLeases.get(normalizeConversationId(conversationId))
    return lease ? [lease.toolDefinition] : []
  }

  async callTool(
    request: MCPToolCall,
    _options?: ToolCallOptions
  ): Promise<{ content: unknown; rawData: MCPToolResponse }> {
    const conversationId = normalizeConversationId(request.conversationId)
    const lease = this.toolLeases.get(conversationId)
    if (!lease || request.function.name !== WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME) {
      throw new Error(
        `Workflow structured-output tool is not active for conversation ${conversationId}.`
      )
    }
    return lease.submit(request)
  }

  private openLease(
    preparedSchema: PreparedWorkflowResultSchema,
    input: {
      runId: string
      invocationId: string
      childSessionId: string
      providerId: string
    }
  ): WorkflowStructuredOutputLease {
    const childSessionId = normalizeConversationId(input.childSessionId)
    normalizeStoredId(input.runId, 'workflow run')
    normalizeStoredId(input.invocationId, 'workflow invocation')
    const mode: OutputMode = input.providerId.trim() === 'acp' ? 'terminal_json' : 'tool'
    if (mode === 'tool' && this.toolLeases.has(childSessionId)) {
      throw new Error(`Workflow structured output is already active for child ${childSessionId}.`)
    }

    let lease!: StructuredOutputLease
    lease = new StructuredOutputLease({
      mode,
      preparedSchema,
      close: () => {
        if (mode !== 'tool' || this.toolLeases.get(childSessionId) !== lease) {
          return
        }
        this.toolLeases.delete(childSessionId)
        try {
          this.options.onCatalogChanged(childSessionId)
        } catch (error) {
          console.warn(
            `[WorkflowStructuredOutputRegistry] Failed to invalidate the tool catalog for child=${childSessionId}:`,
            error
          )
        }
      }
    })
    if (mode === 'tool') {
      this.toolLeases.set(childSessionId, lease)
      try {
        this.options.onCatalogChanged(childSessionId)
      } catch (error) {
        this.toolLeases.delete(childSessionId)
        throw error
      }
    }
    return lease
  }
}

class StructuredOutputLease implements WorkflowStructuredOutputLease {
  private readonly deferred = createDeferredResult()
  private readonly mode: OutputMode
  private readonly preparedSchema: PreparedWorkflowResultSchema
  private readonly onClose: () => void
  private state: LeaseState = 'pending'
  private invalidAttempts = 0
  readonly instruction: string
  readonly result: Promise<JsonValue>
  readonly toolDefinition: MCPToolDefinition

  constructor(input: {
    mode: OutputMode
    preparedSchema: PreparedWorkflowResultSchema
    close(): void
  }) {
    this.mode = input.mode
    this.preparedSchema = input.preparedSchema
    this.onClose = input.close
    this.result = this.deferred.promise
    this.instruction = buildInstruction(input.mode, input.preparedSchema.schemaJson)
    this.toolDefinition = {
      type: 'function',
      source: 'agent',
      function: {
        name: WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME,
        description:
          'Submit the final structured result for the active DeepChat workflow invocation.',
        parameters: input.preparedSchema.schema as MCPToolDefinition['function']['parameters']
      },
      server: {
        name: WORKFLOW_STRUCTURED_OUTPUT_SERVER_NAME,
        icons: '',
        description: 'Invocation-scoped DeepChat workflow control'
      },
      execution: TOOL_EXECUTION.read.sequential
    }
  }

  submit(request: MCPToolCall): { content: unknown; rawData: MCPToolResponse } {
    if (this.mode !== 'tool' || this.state === 'closed') {
      return createToolResponse(
        request,
        'This workflow structured-output channel is no longer active.',
        true
      )
    }
    if (this.state === 'resolved') {
      return createToolResponse(
        request,
        'A workflow result was already accepted. Do not submit another result.',
        true
      )
    }
    if (this.state === 'rejected') {
      return createToolResponse(
        request,
        'The workflow structured-output attempt limit was exhausted.',
        true
      )
    }

    try {
      const result = this.preparedSchema.parseExactJson(request.function.arguments)
      this.resolve(result)
      return createToolResponse(request, 'Workflow result accepted.', false)
    } catch (error) {
      const feedback = this.recordInvalidAttempt(
        error,
        'Call the tool again with corrected arguments.'
      )
      return createToolResponse(
        request,
        feedback ?? 'The workflow structured-output attempt limit was exhausted.',
        true,
        feedback !== null
      )
    }
  }

  completeTurn(answerMarkdown: string): string | null {
    if (this.state !== 'pending') {
      return null
    }
    if (this.mode === 'terminal_json') {
      try {
        this.resolve(this.preparedSchema.parseExactJson(answerMarkdown))
        return null
      } catch (error) {
        return this.recordInvalidAttempt(
          error,
          buildTerminalJsonCorrection(this.preparedSchema.schemaJson)
        )
      }
    }
    return this.recordInvalidAttempt(
      new WorkflowStructuredOutputError(
        'STRUCTURED_RESULT_MISSING',
        `Child turn ended without calling ${WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME}.`
      ),
      `Call ${WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME} with the final result. Do not answer in prose.`
    )
  }

  close(): void {
    if (this.state === 'closed') {
      return
    }
    if (this.state === 'pending') {
      this.reject(
        new WorkflowStructuredOutputError(
          'STRUCTURED_OUTPUT_CLOSED',
          'Workflow structured-output channel closed before a valid result was accepted.',
          true
        )
      )
    }
    this.state = 'closed'
    this.onClose()
  }

  private recordInvalidAttempt(error: unknown, correction: string): string | null {
    this.invalidAttempts += 1
    const detail = normalizeValidationFailure(error)
    if (this.invalidAttempts >= MAX_OUTPUT_ATTEMPTS) {
      this.reject(
        new WorkflowStructuredOutputError(
          'STRUCTURED_OUTPUT_EXHAUSTED',
          `Workflow structured output remained invalid after ${MAX_OUTPUT_ATTEMPTS} attempts. ${detail}`,
          false,
          error === undefined ? undefined : { cause: error }
        )
      )
      return null
    }
    return [
      `Structured output rejected (${this.invalidAttempts}/${MAX_OUTPUT_ATTEMPTS}): ${detail}`,
      correction
    ]
      .join('\n\n')
      .slice(0, MAX_FEEDBACK_LENGTH)
  }

  private resolve(value: JsonValue): void {
    if (this.state !== 'pending') {
      return
    }
    this.state = 'resolved'
    this.deferred.resolve(value)
  }

  private reject(error: unknown): void {
    if (this.state !== 'pending') {
      return
    }
    this.state = 'rejected'
    this.deferred.reject(error)
  }
}

function createDeferredResult(): DeferredResult {
  let resolve!: (value: JsonValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<JsonValue>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function createToolResponse(
  request: MCPToolCall,
  content: string,
  isError: boolean,
  recoverable = true
): { content: unknown; rawData: MCPToolResponse } {
  return {
    content,
    rawData: {
      toolCallId: request.id,
      content,
      isError,
      toolResult: isError
        ? createAgentToolErrorResult(WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME, content, {
            recoverable
          })
        : createAgentToolSuccessResult(WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME, content)
    }
  }
}

function buildInstruction(mode: OutputMode, schemaJson: string): string {
  if (mode === 'tool') {
    return [
      `Finish by calling \`${WORKFLOW_STRUCTURED_OUTPUT_TOOL_NAME}\` exactly once with the final result.`,
      'Do not return the result as prose or a fenced code block.',
      'The tool definition is the authoritative JSON Schema.'
    ].join('\n')
  }
  return [
    'This ACP-backed child cannot use DeepChat-local tools.',
    'Return exactly one JSON value as the entire final answer, with no prose or Markdown fences.',
    `The JSON value must match this schema: ${schemaJson}`
  ].join('\n')
}

function buildTerminalJsonCorrection(schemaJson: string): string {
  return [
    'Return a corrected response containing exactly one JSON value and nothing else.',
    `The JSON value must match this schema: ${schemaJson}`
  ].join('\n')
}

function normalizeValidationFailure(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message.trim()
      : String(error).trim() || 'Unknown validation error.'
  return message.slice(0, MAX_FEEDBACK_LENGTH / 2)
}

function normalizeConversationId(value: string | undefined): string {
  return normalizeStoredId(value, 'conversation')
}

function normalizeStoredId(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized || normalized.length > 256) {
    throw new Error(`${label} id must contain 1-256 characters.`)
  }
  return normalized
}
