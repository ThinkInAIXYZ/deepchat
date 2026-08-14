import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import {
  LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
  type LocalControlErrorCode
} from '@shared/contracts/localControl'
import {
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute
} from '@shared/contracts/routes/tools.routes'
import {
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  type ProgrammaticToolCapabilityV1
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import type { ToolSurfaceSnapshot } from '@/agent/deepchat/runtime/toolSurface'
import {
  bindToolSurfaceCanaryRunEvidence,
  createToolSurfaceCanaryRunEvidenceRecorder
} from '@/agent/deepchat/runtime/toolSurfaceCanaryDiagnostics'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  type AgentCliProgrammaticOperationGrant,
  type AgentCliProgrammaticToolVerb
} from '@/cli/agentTokenAuthority'
import { CliRequestError } from '@/cli/errors'
import { ProgrammaticToolDispatcher } from '@/cli/programmaticToolDispatcher'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { ProgrammaticParentOperationError } from '@/cli/programmaticToolParentController'
import { ExecutionJournalError } from '@/tape/domain/executionJournal'
import { ExecutionContractDispatchError } from '@/tape/domain/executionContract'
import { ToolSurfaceError } from '@/agent/deepchat/runtime/toolSurface'
import { McpPreDispatchError } from '@/mcp/errors'

const SERVER_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const BINDING_HASH = 'a'.repeat(64)

function agentExec(): MCPToolDefinition {
  return {
    source: 'agent',
    execution: TOOL_EXECUTION.write,
    type: 'function',
    function: {
      name: 'exec',
      description: 'Execute an approved command',
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'agent-filesystem',
      icons: '',
      description: 'Agent filesystem tools'
    }
  }
}

function mcpTool(input: {
  name: string
  description?: string
  effect?: 'read' | 'write'
  properties?: Record<string, unknown>
  required?: string[]
  rawMeta?: Record<string, unknown>
}): MCPToolDefinition {
  const properties = input.properties ?? { query: { type: 'string' } }
  return {
    source: 'mcp',
    execution: input.effect === 'write' ? TOOL_EXECUTION.write : TOOL_EXECUTION.read.parallel,
    type: 'function',
    function: {
      name: input.name,
      description: input.description ?? `${input.name} calendar operations`,
      parameters: {
        type: 'object',
        properties,
        ...(input.required ? { required: input.required } : {})
      }
    },
    server: {
      id: SERVER_ID,
      name: 'remote',
      icons: '',
      description: 'Remote MCP tools',
      configGeneration: 1,
      bindingHash: BINDING_HASH
    },
    raw: {
      name: input.name,
      inputSchema: { type: 'object', properties },
      ...(input.rawMeta ? { _meta: input.rawMeta } : {})
    }
  }
}

function buildCapability(input: {
  definitions: readonly MCPToolDefinition[]
  providerActiveDefinitions?: readonly MCPToolDefinition[]
  maxInputBytes?: number
  maxOutputBytes?: number
  maxDurationMs?: number
}): Readonly<{ capability: ProgrammaticToolCapabilityV1; snapshot: ToolSurfaceSnapshot }> {
  const exec = input.definitions.find((definition) => definition.function.name === 'exec')
  if (!exec) throw new Error('Test capability requires exec')
  const controller = createProgrammaticToolSurfaceRunControllerV1({
    ceilingDefinitions: input.definitions,
    providerActiveDefinitions: input.providerActiveDefinitions ?? [exec],
    policyVersion: 'dispatcher-test-v1'
  })
  const snapshot = controller.build({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq: 1
    },
    eligibleDefinitions: input.definitions
  })
  const capability = buildProgrammaticToolCapabilityV1({
    snapshot,
    taskContractContext: null,
    ceilings: {
      maxToolEffect: 'write',
      workspace: { kind: 'runtime_default' },
      maxSubagentDepth: 0
    },
    quotas: {
      maxChildren: 8,
      maxBatchSteps: 8,
      maxInputBytes: input.maxInputBytes ?? 1024 * 1024,
      maxOutputBytes: input.maxOutputBytes ?? 1024 * 1024,
      maxDurationMs: input.maxDurationMs ?? 30_000
    }
  })
  return { capability, snapshot }
}

function operationGrant(
  capability: ProgrammaticToolCapabilityV1,
  verb: AgentCliProgrammaticToolVerb
): AgentCliProgrammaticOperationGrant {
  const operation = {
    sessionId: capability.request.sessionId,
    messageId: capability.request.messageId,
    runId: capability.request.runId,
    requestSeq: capability.request.requestSeq,
    providerToolCallId: 'provider-call-1'
  }
  return {
    schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    operation,
    command: { domain: 'tool', verb },
    route: `tool.${verb}`,
    canonicalInvocationHash: 'b'.repeat(64),
    adapterMode: 'cli-programmatic',
    capabilityHash: capability.capabilityHash,
    programmaticSurfaceHash: capability.programmaticSurfaceHash,
    quotas: capability.quotas,
    outerDispatchReceipt: { sessionId: operation.sessionId, entryId: 1 }
  }
}

function agentCaller(conversationId = 'session-1'): CliRouteCaller {
  return {
    kind: 'cli',
    principal: 'agent',
    connectionId: 'connection-1',
    tokenId: 'token-1',
    scopes: [],
    conversationId,
    expiresAt: Date.now() + 60_000
  }
}

function createDispatcher(input: ReturnType<typeof buildCapability>) {
  const resolveInvocation = vi.fn(() => ({ ...input, permissionMode: 'default' as const }))
  const recordDiscoveryResult = vi.fn()
  const commitChildDispatch = vi.fn()
  const commitChildOutcome = vi.fn()
  const failToolInvocationBeforePlan = vi.fn()
  const materializeChild = vi.fn()
  const recordToolInvocationResult = vi.fn()
  const reserveChildren = vi.fn()
  const stopBeforeChild = vi.fn()
  const executeChild = vi.fn()
  const authorizeChild = vi.fn()
  const cancelChildPermission = vi.fn()
  const takeSettlementOwnership = vi.fn()
  const implementation = new ProgrammaticToolDispatcher({
    parents: {
      commitChildDispatch,
      commitChildOutcome,
      failToolInvocationBeforePlan,
      materializeChild,
      recordDiscoveryResult,
      recordToolInvocationResult,
      reserveChildren,
      resolveInvocation,
      stopBeforeChild
    },
    executeChild,
    authorizeChild,
    cancelChildPermission
  })
  return {
    dispatcher: {
      completePreDispatchFailure: implementation.completePreDispatchFailure.bind(implementation),
      dispatch: (
        method: string,
        request: unknown,
        caller: CliRouteCaller,
        grant: AgentCliProgrammaticOperationGrant,
        signal: AbortSignal
      ) => implementation.dispatch(method, request, caller, grant, signal, takeSettlementOwnership)
    },
    authorizeChild,
    cancelChildPermission,
    commitChildDispatch,
    commitChildOutcome,
    executeChild,
    failToolInvocationBeforePlan,
    materializeChild,
    resolveInvocation,
    recordDiscoveryResult,
    recordToolInvocationResult,
    reserveChildren,
    stopBeforeChild,
    takeSettlementOwnership
  }
}

async function expectCliError(
  promise: Promise<unknown>,
  code: LocalControlErrorCode
): Promise<CliRequestError> {
  try {
    await promise
    throw new Error('Expected CliRequestError')
  } catch (error) {
    expect(error).toBeInstanceOf(CliRequestError)
    expect((error as CliRequestError).code).toBe(code)
    return error as CliRequestError
  }
}

describe('ProgrammaticToolDispatcher', () => {
  it('records typed route failures before creating a child plan', () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    const grant = operationGrant(context.capability, 'call')

    fixture.dispatcher.completePreDispatchFailure(
      toolCallRoute.name,
      grant,
      new CliRequestError('rate_limited', 'Agent compute capacity is full', {
        retriable: true
      })
    )

    expect(fixture.failToolInvocationBeforePlan).toHaveBeenCalledWith(grant, {
      responseText: JSON.stringify(
        {
          status: 'error',
          error: {
            code: 'rate_limited',
            message: 'Agent compute capacity is full',
            retriable: true
          }
        },
        null,
        2
      ),
      isError: true
    })
    expect(fixture.reserveChildren).not.toHaveBeenCalled()
    expect(fixture.commitChildDispatch).not.toHaveBeenCalled()
  })

  it('leaves malformed request settlement with the pre-dispatch owner', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 42, arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toThrow()

    expect(fixture.takeSettlementOwnership).not.toHaveBeenCalled()
    expect(fixture.failToolInvocationBeforePlan).not.toHaveBeenCalled()
    expect(fixture.reserveChildren).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('searches only the frozen Programmatic Surface with deterministic bounded summaries', async () => {
    const exec = agentExec()
    const nativePinned = mcpTool({ name: 'calendar_native' })
    const zeta = mcpTool({ name: 'calendar_zeta' })
    const alpha = mcpTool({
      name: 'calendar_alpha',
      description: `calendar ${'😀'.repeat(3_000)}`,
      effect: 'write',
      properties: Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [`field_${index}`, { type: 'string' }])
      ),
      required: ['field_0']
    })
    const context = buildCapability({
      definitions: [zeta, nativePinned, exec, alpha],
      providerActiveDefinitions: [exec, nativePinned]
    })
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    bindToolSurfaceCanaryRunEvidence(context.snapshot, evidence)
    const { dispatcher, recordDiscoveryResult, takeSettlementOwnership } = createDispatcher(context)

    const output = toolSearchRoute.output.parse(
      await dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'calendar', limit: 32 },
        agentCaller(),
        operationGrant(context.capability, 'search'),
        new AbortController().signal
      )
    )

    expect(output.tools.map((tool) => tool.name)).toEqual(['calendar_alpha', 'calendar_zeta'])
    expect(output.tools.some((tool) => tool.name === 'calendar_native')).toBe(false)
    expect(output.tools[0]).toMatchObject({ source: 'mcp', effect: 'write' })
    expect(output.tools[0]?.description.length).toBeLessThanOrEqual(2_048)
    expect(output.tools[0]?.description).not.toMatch(/[\uD800-\uDBFF]$/u)
    expect(output.tools[0]?.inputSignature).toContain('field_0: string')
    expect(output.tools[0]?.inputSignature).toContain('...')
    expect(output.tools[0]?.callExample).toContain('deepchat tool call')
    expect(output.truncated).toBe(false)
    expect(recordDiscoveryResult).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'tool.search' }),
      {
        responseText: `${JSON.stringify(output, null, 2)}\nExit Code: 0`,
        isError: false
      }
    )
    expect(takeSettlementOwnership).toHaveBeenCalledOnce()
    expect(takeSettlementOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      recordDiscoveryResult.mock.invocationCallOrder[0]
    )
    await dispatcher.dispatch(
      toolDescribeRoute.name,
      { target: 'calendar_alpha' },
      agentCaller(),
      operationGrant(context.capability, 'describe'),
      new AbortController().signal
    )
    await dispatcher.dispatch(
      toolSearchRoute.name,
      { query: 'calendar', limit: 32 },
      agentCaller(),
      operationGrant(context.capability, 'search'),
      new AbortController().signal
    )
    expect(evidence.snapshot().discovery).toEqual({
      searchCalls: 2,
      describeCalls: 1,
      failedCalls: 0,
      zeroResultCalls: 0,
      returnedTargetResults: 5,
      repeatedSearchTargetResults: 2
    })
  })

  it('describes canonical input schema without exposing internal target metadata', async () => {
    const secretMarker = 'must-not-leak-from-mcp-meta'
    const exec = agentExec()
    const remote = mcpTool({
      name: 'remote_search',
      properties: { query: { type: 'string' } },
      required: ['query'],
      rawMeta: { secretMarker }
    })
    const context = buildCapability({ definitions: [exec, remote] })
    const { dispatcher, recordDiscoveryResult } = createDispatcher(context)

    const output = toolDescribeRoute.output.parse(
      await dispatcher.dispatch(
        toolDescribeRoute.name,
        { target: 'remote_search' },
        agentCaller(),
        operationGrant(context.capability, 'describe'),
        new AbortController().signal
      )
    )
    const serialized = JSON.stringify(output)

    expect(output.tool.inputSchema).toEqual(remote.function.parameters)
    expect(output.tool.callExample).toContain('remote_search')
    expect(serialized).not.toContain(SERVER_ID)
    expect(serialized).not.toContain(BINDING_HASH)
    expect(serialized).not.toContain(context.capability.capabilityHash)
    expect(serialized).not.toContain(secretMarker)
    expect(recordDiscoveryResult).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'tool.describe' }),
      expect.objectContaining({ isError: false })
    )
  })

  it('rejects target and property names that cannot cross the CLI boundary safely', () => {
    const exec = agentExec()
    expect(() =>
      buildCapability({ definitions: [exec, mcpTool({ name: 'remote\nsearch' })] })
    ).toThrow('target name that cannot cross the CLI boundary')
    expect(() =>
      buildCapability({
        definitions: [
          exec,
          mcpTool({ name: 'remote_search', properties: { 'unsafe\u202ename': { type: 'string' } } })
        ]
      })
    ).toThrow('input property that cannot cross the CLI boundary')
  })

  it('uses one anti-oracle shape for unknown and provider-active targets', async () => {
    const exec = agentExec()
    const nativePinned = mcpTool({ name: 'calendar_native' })
    const context = buildCapability({
      definitions: [exec, nativePinned, mcpTool({ name: 'remote_search' })],
      providerActiveDefinitions: [exec, nativePinned]
    })
    const { dispatcher, recordDiscoveryResult } = createDispatcher(context)
    const grant = operationGrant(context.capability, 'describe')

    const unknown = await expectCliError(
      dispatcher.dispatch(
        toolDescribeRoute.name,
        { target: 'does_not_exist' },
        agentCaller(),
        grant,
        new AbortController().signal
      ),
      'not_found'
    )
    const providerActive = await expectCliError(
      dispatcher.dispatch(
        toolDescribeRoute.name,
        { target: 'calendar_native' },
        agentCaller(),
        grant,
        new AbortController().signal
      ),
      'not_found'
    )

    expect(providerActive.message).toBe(unknown.message)
    expect(providerActive.httpStatus).toBe(unknown.httpStatus)
    expect(recordDiscoveryResult).toHaveBeenCalledTimes(2)
    expect(recordDiscoveryResult).toHaveBeenNthCalledWith(1, grant, {
      responseText: 'Error: Tool is not available in the current session',
      isError: true
    })
  })

  it('truncates search to the capability output quota and rejects oversized descriptions', async () => {
    const exec = agentExec()
    const context = buildCapability({
      definitions: [exec, mcpTool({ name: 'remote_search' })],
      maxOutputBytes: 100
    })
    const { dispatcher, recordDiscoveryResult } = createDispatcher(context)

    const search = toolSearchRoute.output.parse(
      await dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'remote' },
        agentCaller(),
        operationGrant(context.capability, 'search'),
        new AbortController().signal
      )
    )
    expect(search).toEqual({ tools: [], truncated: true })

    await expectCliError(
      dispatcher.dispatch(
        toolDescribeRoute.name,
        { target: 'remote_search' },
        agentCaller(),
        operationGrant(context.capability, 'describe'),
        new AbortController().signal
      ),
      'result_too_large'
    )
    expect(recordDiscoveryResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ route: 'tool.describe' }),
      {
        responseText: 'Error: Programmatic Tool result exceeds its output quota',
        isError: true
      }
    )
  })

  it('executes one frozen child between nested T1 and T2 before publishing its result', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    bindToolSurfaceCanaryRunEvidence(context.snapshot, evidence)
    const fixture = createDispatcher(context)
    const projection = vi.fn()
    fixture.executeChild.mockImplementation(async (input) => {
      input.registerOutcomeProjection(projection)
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: { query: 'calendar' },
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      return {
        content: 'calendar result',
        rawData: { toolCallId: input.request.id, content: 'calendar result' }
      }
    })
    const grant = operationGrant(context.capability, 'call')

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: { query: 'calendar' } },
        agentCaller(),
        grant,
        new AbortController().signal
      )
    )

    expect(fixture.takeSettlementOwnership).toHaveBeenCalledOnce()
    expect(fixture.takeSettlementOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.reserveChildren.mock.invocationCallOrder[0]
    )
    expect(output).toEqual({
      step: { childOrdinal: 0, status: 'success', result: 'calendar result' }
    })
    expect(fixture.reserveChildren).toHaveBeenCalledWith(
      grant,
      expect.arrayContaining([
        expect.objectContaining({
          childOrdinal: 0,
          toolName: 'remote_search',
          toolSource: 'mcp',
          definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/)
        })
      ])
    )
    expect(fixture.materializeChild).toHaveBeenCalledWith(
      grant,
      expect.objectContaining({
        childOrdinal: 0,
        normalizedArguments: { query: 'calendar' }
      })
    )
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).toHaveBeenCalledWith(grant, {
      childOrdinal: 0,
      responseText: 'calendar result',
      isError: false
    })
    expect(projection).toHaveBeenCalledOnce()
    expect(projection.mock.invocationCallOrder[0]).toBeGreaterThan(
      fixture.commitChildOutcome.mock.invocationCallOrder[0]
    )
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      grant,
      expect.objectContaining({ isError: false })
    )
    expect(evidence.snapshot().quality).toEqual({
      settledToolResults: 1,
      successfulSettledToolResults: 1,
      failedSettledToolResults: 0
    })
  })

  it('executes a frozen batch sequentially with bounded prior-result bindings', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'messages_list' }),
        mcpTool({
          name: 'messages_read',
          properties: { id: { type: 'string' }, options: { type: 'object' } }
        })
      ]
    })
    const fixture = createDispatcher(context)
    const projections = [vi.fn(), vi.fn()]
    fixture.executeChild.mockImplementation(async (input) => {
      const childOrdinal = fixture.executeChild.mock.calls.length - 1
      const argumentsValue = JSON.parse(input.request.function.arguments) as Record<string, unknown>
      input.registerOutcomeProjection(projections[childOrdinal])
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: argumentsValue,
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      if (input.request.function.name === 'messages_list') {
        return {
          content: 'one message',
          rawData: {
            toolCallId: input.request.id,
            content: 'one message',
            structuredContent: { items: [{ id: 'message-1' }] }
          }
        }
      }
      return {
        content: `read ${String(argumentsValue.id)}`,
        rawData: { toolCallId: input.request.id, content: `read ${String(argumentsValue.id)}` }
      }
    })
    const grant = operationGrant(context.capability, 'batch')
    const request = {
      steps: [
        { target: 'messages_list', arguments: { query: 'unread' } },
        {
          target: 'messages_read',
          arguments: { id: null, options: { source: 'inbox' } },
          bindings: [{ to: '/id', from: '$steps/0/result/items/0/id' }]
        }
      ]
    }

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        request,
        agentCaller(),
        grant,
        new AbortController().signal
      )
    )

    expect(output).toEqual({
      steps: [
        {
          childOrdinal: 0,
          status: 'success',
          result: { items: [{ id: 'message-1' }] }
        },
        { childOrdinal: 1, status: 'success', result: 'read message-1' }
      ]
    })
    expect(fixture.reserveChildren).toHaveBeenCalledWith(grant, [
      expect.objectContaining({ childOrdinal: 0, toolName: 'messages_list' }),
      expect.objectContaining({
        childOrdinal: 1,
        toolName: 'messages_read',
        argumentTemplate: {
          arguments: request.steps[1].arguments,
          bindings: request.steps[1].bindings
        }
      })
    ])
    expect(fixture.executeChild).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fixture.executeChild.mock.calls[1][0].request.function.arguments)).toEqual({
      id: 'message-1',
      options: { source: 'inbox' }
    })
    expect(fixture.materializeChild).toHaveBeenNthCalledWith(
      2,
      grant,
      expect.objectContaining({
        childOrdinal: 1,
        normalizedArguments: { id: 'message-1', options: { source: 'inbox' } }
      })
    )
    expect(fixture.commitChildOutcome).toHaveBeenNthCalledWith(1, grant, {
      childOrdinal: 0,
      responseText: 'one message',
      isError: false
    })
    expect(fixture.commitChildOutcome).toHaveBeenNthCalledWith(2, grant, {
      childOrdinal: 1,
      responseText: 'read message-1',
      isError: false
    })
    expect(projections.every((projection) => projection.mock.calls.length === 1)).toBe(true)
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      grant,
      expect.objectContaining({ isError: false })
    )
  })

  it('stops a batch before T1 when a static prior-result path is missing', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'messages_list' }),
        mcpTool({ name: 'messages_read' }),
        mcpTool({ name: 'messages_archive' })
      ]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      return {
        content: 'no messages',
        rawData: {
          toolCallId: input.request.id,
          content: 'no messages',
          structuredContent: { items: [] }
        }
      }
    })

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'messages_list', arguments: {} },
            {
              target: 'messages_read',
              arguments: { id: null },
              bindings: [{ to: '/id', from: '$steps/0/result/items/0/id' }]
            },
            { target: 'messages_archive', arguments: { id: 'message-1' } }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    )

    expect(output.steps).toEqual([
      { childOrdinal: 0, status: 'success', result: { items: [] } },
      {
        childOrdinal: 1,
        status: 'error',
        error: {
          code: 'invalid_request',
          message: 'Programmatic Tool binding source is unavailable',
          retriable: false
        }
      },
      { childOrdinal: 2, status: 'not_started' }
    ])
    expect(fixture.executeChild).toHaveBeenCalledOnce()
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).toHaveBeenCalledOnce()
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 1)
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isError: true })
    )
  })

  it('rejects materialized binding amplification before the next child T1', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'remote_source' }),
        mcpTool({ name: 'remote_sink' })
      ],
      maxInputBytes: 512
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      return {
        content: 'large structured result',
        rawData: {
          toolCallId: input.request.id,
          content: 'large structured result',
          structuredContent: { payload: 'x'.repeat(1_024) }
        }
      }
    })

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_source', arguments: {} },
            {
              target: 'remote_sink',
              arguments: { payload: null },
              bindings: [{ to: '/payload', from: '$steps/0/result/payload' }]
            }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    )

    expect(output.steps[1]).toMatchObject({
      childOrdinal: 1,
      status: 'error',
      error: { code: 'quota_exceeded' }
    })
    expect(fixture.executeChild).toHaveBeenCalledOnce()
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 1)
  })

  it('uses one pre-plan anti-oracle batch result when any target is unavailable', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_known' })]
    })
    const fixture = createDispatcher(context)

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_known', arguments: {} },
            { target: 'remote_unknown', arguments: {} }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    )

    expect(output.steps).toEqual([
      {
        childOrdinal: 0,
        status: 'error',
        error: {
          code: 'not_found',
          message: 'Tool is not available in the current session',
          retriable: false
        }
      },
      { childOrdinal: 1, status: 'not_started' }
    ])
    expect(fixture.takeSettlementOwnership).toHaveBeenCalledOnce()
    expect(fixture.takeSettlementOwnership.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.failToolInvocationBeforePlan.mock.invocationCallOrder[0]
    )
    expect(fixture.failToolInvocationBeforePlan).toHaveBeenCalledOnce()
    expect(fixture.reserveChildren).not.toHaveBeenCalled()
    expect(fixture.executeChild).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'disabled runtime authority',
      error: new ExecutionContractDispatchError('sensitive disabled target', 'tool_not_allowed'),
      code: 'tool_disabled',
      message: 'Tool is disabled by current runtime authority',
      retriable: false
    },
    {
      label: 'removed runtime target',
      error: new ExecutionContractDispatchError('sensitive removed target', 'target_mismatch'),
      code: 'target_unavailable',
      message: 'Tool target is no longer available in the current session',
      retriable: false
    },
    {
      label: 'drifted runtime definition',
      error: new ToolSurfaceError('sensitive changed schema', 'conflicting_tool'),
      code: 'definition_changed',
      message: 'Tool definition changed after the current Programmatic Surface was frozen',
      retriable: false
    },
    {
      label: 'reduced runtime ceiling',
      error: new ToolSurfaceError('sensitive workspace path', 'ineligible_exposure'),
      code: 'authority_changed',
      message: 'Tool execution authority changed after the current Programmatic Surface was frozen',
      retriable: false
    },
    {
      label: 'temporarily unavailable runtime authority',
      error: new ExecutionContractDispatchError(
        'sensitive runtime authority failure',
        'invalid_runtime_authority'
      ),
      code: 'runtime_authority_unavailable',
      message: 'Current runtime authority is temporarily unavailable',
      retriable: true
    },
    {
      label: 'late MCP binding change',
      error: new McpPreDispatchError('sensitive binding details', 'target_changed'),
      code: 'target_changed',
      message: 'Tool target changed after the current Programmatic Surface was frozen',
      retriable: false
    },
    {
      label: 'late MCP request rejection',
      error: new McpPreDispatchError('sensitive argument details', 'invalid_request'),
      code: 'invalid_request',
      message: 'Tool arguments were rejected before dispatch',
      retriable: false
    },
    {
      label: 'late MCP runtime loss',
      error: new McpPreDispatchError('sensitive runtime details', 'runtime_unavailable'),
      code: 'runtime_unavailable',
      message: 'Tool runtime is temporarily unavailable',
      retriable: true
    }
  ])('returns a bounded specific step for a known target with $label', async (expected) => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_known' })]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockRejectedValue(expected.error)

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_known', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    )

    expect(output.step).toEqual({
      childOrdinal: 0,
      status: 'error',
      error: {
        code: expected.code,
        message: expected.message,
        retriable: expected.retriable
      }
    })
    expect(JSON.stringify(output)).not.toContain(expected.error.message)
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 0)
    expect(fixture.commitChildDispatch).not.toHaveBeenCalled()
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
  })

  it('settles a known target error and leaves later batch children unstarted', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'remote_failing' }),
        mcpTool({ name: 'remote_later' })
      ]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      return {
        content: 'remote target failed',
        rawData: {
          toolCallId: input.request.id,
          content: 'remote target failed',
          isError: true
        }
      }
    })

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_failing', arguments: {} },
            { target: 'remote_later', arguments: {} }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    )

    expect(output.steps).toEqual([
      {
        childOrdinal: 0,
        status: 'error',
        error: {
          code: 'tool_error',
          message: 'remote target failed',
          retriable: false
        }
      },
      { childOrdinal: 1, status: 'not_started' }
    ])
    expect(fixture.executeChild).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).toHaveBeenCalledWith(expect.anything(), {
      childOrdinal: 0,
      responseText: 'remote target failed',
      isError: true
    })
    expect(fixture.stopBeforeChild).not.toHaveBeenCalled()
  })

  it('keeps a completed child settled when the next nested T2 fails', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'remote_first' }),
        mcpTool({ name: 'remote_second' })
      ]
    })
    const fixture = createDispatcher(context)
    const projections = [vi.fn(), vi.fn()]
    fixture.executeChild.mockImplementation(async (input) => {
      const childOrdinal = fixture.executeChild.mock.calls.length - 1
      input.registerOutcomeProjection(projections[childOrdinal])
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      return {
        content: `result-${childOrdinal}`,
        rawData: { toolCallId: input.request.id, content: `result-${childOrdinal}` }
      }
    })
    fixture.commitChildOutcome.mockImplementation((_grant, input) => {
      if (input.childOrdinal === 1) throw new Error('nested T2 disk full')
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_first', arguments: {} },
            { target: 'remote_second', arguments: {} }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    ).rejects.toThrow('nested T2 disk full')

    expect(projections[0]).toHaveBeenCalledOnce()
    expect(projections[1]).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('records settled child quality before a later result projection fails', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    bindToolSurfaceCanaryRunEvidence(context.snapshot, evidence)
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.registerOutcomeProjection(() => {
        throw new Error('projection failed')
      })
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      return {
        content: 'remote result',
        rawData: { toolCallId: input.request.id, content: 'remote result' }
      }
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: 'CommittedToolOutcomeProjectionError',
      code: 'projection_failed',
      cause: expect.objectContaining({ message: 'projection failed' })
    })

    expect(fixture.commitChildOutcome).toHaveBeenCalledOnce()
    expect(evidence.snapshot().quality).toEqual({
      settledToolResults: 1,
      successfulSettledToolResults: 1,
      failedSettledToolResults: 0
    })
  })

  it('stops before the next child T1 when cancellation follows a settled batch child', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'remote_first' }),
        mcpTool({ name: 'remote_second' }),
        mcpTool({ name: 'remote_third' })
      ]
    })
    const fixture = createDispatcher(context)
    const controller = new AbortController()
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: input.request.function.name,
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: input.request.function.name }
      })
      return {
        content: 'first result',
        rawData: { toolCallId: input.request.id, content: 'first result' }
      }
    })
    fixture.commitChildOutcome.mockImplementation((_grant, input) => {
      if (input.childOrdinal === 0) {
        controller.abort(new CliRequestError('cancelled', 'Request was cancelled'))
      }
    })

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_first', arguments: {} },
            { target: 'remote_second', arguments: {} },
            { target: 'remote_third', arguments: {} }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        controller.signal
      )
    )

    expect(output.steps).toEqual([
      { childOrdinal: 0, status: 'success', result: 'first result' },
      {
        childOrdinal: 1,
        status: 'error',
        error: {
          code: 'cancelled',
          message: 'Programmatic Tool execution was cancelled',
          retriable: false
        }
      },
      { childOrdinal: 2, status: 'not_started' }
    ])
    expect(fixture.executeChild).toHaveBeenCalledOnce()
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).toHaveBeenCalledOnce()
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 1)
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isError: true })
    )
  })

  it('keeps a post-T1 cancellation indeterminate instead of inventing nested T2', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_slow' })]
    })
    const fixture = createDispatcher(context)
    const controller = new AbortController()
    const cancellation = new CliRequestError('cancelled', 'Request was cancelled')
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_slow',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_slow' }
      })
      controller.abort(cancellation)
      input.signal.throwIfAborted()
      throw new Error('unreachable')
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_slow', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        controller.signal
      )
    ).rejects.toBe(cancellation)

    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.stopBeforeChild).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('settles an owned timeout before child T1 without inventing a nested operation', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_slow' })],
      maxDurationMs: 5
    })
    const evidence = createToolSurfaceCanaryRunEvidenceRecorder()
    bindToolSurfaceCanaryRunEvidence(context.snapshot, evidence)
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(
      async (input) =>
        await new Promise<never>((_resolve, reject) => {
          const rejectWithAbort = () => reject(input.signal.reason)
          if (input.signal.aborted) rejectWithAbort()
          else input.signal.addEventListener('abort', rejectWithAbort, { once: true })
        })
    )

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_slow', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    )

    expect(output.step).toEqual({
      childOrdinal: 0,
      status: 'error',
      error: {
        code: 'timeout',
        message: 'Programmatic Tool execution timed out',
        retriable: false
      }
    })
    expect(fixture.commitChildDispatch).not.toHaveBeenCalled()
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 0)
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isError: true })
    )
    expect(evidence.snapshot().quality).toEqual({
      settledToolResults: 0,
      successfulSettledToolResults: 0,
      failedSettledToolResults: 0
    })
  })

  it('stops a batch before T1 when approval for a later child is denied', async () => {
    const context = buildCapability({
      definitions: [
        agentExec(),
        mcpTool({ name: 'remote_read' }),
        mcpTool({ name: 'remote_write', effect: 'write' }),
        mcpTool({ name: 'remote_later' })
      ]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild
      .mockImplementationOnce(async (input) => {
        input.commitDispatch({
          toolName: 'remote_read',
          toolSource: 'mcp',
          normalizedArguments: {},
          target: { serverName: 'remote', originalName: 'remote_read' }
        })
        return {
          content: 'read result',
          rawData: { toolCallId: input.request.id, content: 'read result' }
        }
      })
      .mockResolvedValueOnce({
        content: 'Permission required',
        rawData: {
          toolCallId: 'child-2',
          content: 'Permission required',
          requiresPermission: true,
          permissionRequest: {
            needsPermission: true,
            requestId: 'permission-2',
            toolName: 'remote_write',
            serverName: 'remote',
            permissionType: 'write',
            description: 'Permission required'
          } as never
        }
      })
    fixture.authorizeChild.mockRejectedValueOnce(
      new CliRequestError('approval_denied', 'Programmatic Tool permission was denied', {
        httpStatus: 403
      })
    )

    const output = toolBatchRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolBatchRoute.name,
        {
          steps: [
            { target: 'remote_read', arguments: {} },
            { target: 'remote_write', arguments: {} },
            { target: 'remote_later', arguments: {} }
          ]
        },
        agentCaller(),
        operationGrant(context.capability, 'batch'),
        new AbortController().signal
      )
    )

    expect(output.steps).toEqual([
      { childOrdinal: 0, status: 'success', result: 'read result' },
      {
        childOrdinal: 1,
        status: 'error',
        error: {
          code: 'approval_denied',
          message: 'Programmatic Tool permission was denied',
          retriable: false
        }
      },
      { childOrdinal: 2, status: 'not_started' }
    ])
    expect(fixture.executeChild).toHaveBeenCalledTimes(2)
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
    expect(fixture.commitChildOutcome).toHaveBeenCalledOnce()
    expect(fixture.cancelChildPermission).toHaveBeenCalledWith('permission-2', 'session-1')
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 1)
  })

  it('parks one child approval before T1 and consumes it through the exact second dispatch', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_write', effect: 'write' })]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild
      .mockResolvedValueOnce({
        content: 'Permission required',
        rawData: {
          toolCallId: 'child-1',
          content: 'Permission required',
          requiresPermission: true,
          permissionRequest: {
            needsPermission: true,
            requestId: 'permission-1',
            toolName: 'remote_write',
            serverName: 'remote',
            permissionType: 'write',
            description: 'Permission required'
          } as never
        }
      })
      .mockImplementationOnce(async (input) => {
        input.commitDispatch({
          toolName: 'remote_write',
          toolSource: 'mcp',
          normalizedArguments: { value: 'approved' },
          target: { serverName: 'remote', originalName: 'remote_write' }
        })
        return {
          content: 'written',
          rawData: { toolCallId: input.request.id, content: 'written' }
        }
      })
    const grant = operationGrant(context.capability, 'call')

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_write', arguments: { value: 'approved' } },
        agentCaller(),
        grant,
        new AbortController().signal
      )
    )

    expect(output.step.status).toBe('success')
    expect(fixture.authorizeChild).toHaveBeenCalledWith(
      expect.objectContaining({
        grant,
        childOrdinal: 0,
        permission: expect.objectContaining({ requestId: 'permission-1' })
      })
    )
    expect(fixture.cancelChildPermission).toHaveBeenCalledWith('permission-1', 'session-1')
    expect(fixture.executeChild).toHaveBeenCalledTimes(2)
    expect(fixture.commitChildDispatch).toHaveBeenCalledOnce()
  })

  it('fails the Run boundary when a child asks for permission after nested T1', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_write', effect: 'write' })]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_write',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_write' }
      })
      return {
        content: 'Permission required',
        rawData: {
          toolCallId: input.request.id,
          content: 'Permission required',
          requiresPermission: true,
          permissionRequest: {
            needsPermission: true,
            requestId: 'late-permission',
            toolName: 'remote_write',
            serverName: 'remote',
            permissionType: 'write',
            description: 'Permission required'
          } as never
        }
      }
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_write', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: 'ExecutionJournalError', code: 'invalid_fact' })
    expect(fixture.authorizeChild).not.toHaveBeenCalled()
    expect(fixture.cancelChildPermission).toHaveBeenCalledWith('late-permission', 'session-1')
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('uses one pre-plan anti-oracle result for unknown and provider-active call targets', async () => {
    const exec = agentExec()
    const nativePinned = mcpTool({ name: 'calendar_native' })
    const context = buildCapability({
      definitions: [exec, nativePinned, mcpTool({ name: 'remote_search' })],
      providerActiveDefinitions: [exec, nativePinned]
    })
    const fixture = createDispatcher(context)
    const grant = operationGrant(context.capability, 'call')

    const unknown = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'does_not_exist', arguments: {} },
        agentCaller(),
        grant,
        new AbortController().signal
      )
    )
    const providerActive = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'calendar_native', arguments: {} },
        agentCaller(),
        grant,
        new AbortController().signal
      )
    )

    expect(providerActive).toEqual(unknown)
    expect(fixture.failToolInvocationBeforePlan).toHaveBeenCalledTimes(2)
    expect(fixture.reserveChildren).not.toHaveBeenCalled()
    expect(fixture.executeChild).not.toHaveBeenCalled()
  })

  it('propagates nested outcome persistence failure before result projection', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    const projection = vi.fn()
    fixture.executeChild.mockImplementation(async (input) => {
      input.registerOutcomeProjection(projection)
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      return {
        content: 'known result',
        rawData: { toolCallId: input.request.id, content: 'known result' }
      }
    })
    fixture.commitChildOutcome.mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toThrow('disk full')
    expect(projection).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('settles a bounded pre-T1 plan quota error without inventing a child dispatch', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    fixture.reserveChildren.mockImplementationOnce(() => {
      throw new ProgrammaticParentOperationError(
        'Programmatic child plan exceeds its aggregate input quota',
        'quota_exceeded'
      )
    })

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    )

    expect(output.step).toMatchObject({
      childOrdinal: 0,
      status: 'error',
      error: { code: 'quota_exceeded' }
    })
    expect(fixture.executeChild).not.toHaveBeenCalled()
    expect(fixture.commitChildDispatch).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isError: true })
    )
  })

  it('propagates nested dispatch persistence failure instead of reducing it to CLI output', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    fixture.commitChildDispatch.mockImplementationOnce(() => {
      throw new Error('nested T1 disk full')
    })
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      return {
        content: 'unreachable',
        rawData: { toolCallId: input.request.id, content: 'unreachable' }
      }
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toThrow('nested T1 disk full')
    expect(fixture.stopBeforeChild).not.toHaveBeenCalled()
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('propagates Journal failure after nested T1 instead of inventing a child T2', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      throw new ExecutionJournalError('nested projection boundary failed', 'projection_failed')
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: 'ExecutionJournalError',
      code: 'projection_failed'
    })
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('propagates parent identity corruption before nested T1', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    fixture.materializeChild.mockImplementationOnce(() => {
      throw new ProgrammaticParentOperationError(
        'Programmatic child argument template changed after plan reservation',
        'identity_mismatch'
      )
    })
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      throw new Error('unreachable')
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      name: 'ProgrammaticParentOperationError',
      code: 'identity_mismatch'
    })
    expect(fixture.stopBeforeChild).not.toHaveBeenCalled()
    expect(fixture.commitChildOutcome).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('rejects an outcome projection registered without nested T1', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.registerOutcomeProjection(vi.fn())
      return {
        content: 'uncommitted',
        rawData: { toolCallId: input.request.id, content: 'uncommitted' }
      }
    })

    await expect(
      fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: 'ExecutionJournalError', code: 'invalid_fact' })
    expect(fixture.stopBeforeChild).not.toHaveBeenCalled()
    expect(fixture.recordToolInvocationResult).not.toHaveBeenCalled()
  })

  it('cancels a repeated permission request and stops before child T1', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_write', effect: 'write' })]
    })
    const fixture = createDispatcher(context)
    const permissionResponse = (requestId: string) => ({
      content: 'Permission required',
      rawData: {
        toolCallId: 'child-1',
        content: 'Permission required',
        requiresPermission: true,
        permissionRequest: {
          needsPermission: true,
          requestId,
          toolName: 'remote_write',
          serverName: 'remote',
          permissionType: 'write',
          description: 'Permission required'
        } as never
      }
    })
    fixture.executeChild
      .mockResolvedValueOnce(permissionResponse('permission-1'))
      .mockResolvedValueOnce(permissionResponse('permission-2'))

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_write', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    )

    expect(output.step).toMatchObject({
      status: 'error',
      error: { code: 'approval_denied' }
    })
    expect(fixture.cancelChildPermission).toHaveBeenCalledWith('permission-1', 'session-1')
    expect(fixture.cancelChildPermission).toHaveBeenCalledWith('permission-2', 'session-1')
    expect(fixture.stopBeforeChild).toHaveBeenCalledWith(expect.anything(), 0)
    expect(fixture.commitChildDispatch).not.toHaveBeenCalled()
  })

  it('bounds a known post-T1 execution failure before nested T2', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })],
      maxOutputBytes: 512
    })
    const fixture = createDispatcher(context)
    fixture.executeChild.mockImplementation(async (input) => {
      input.commitDispatch({
        toolName: 'remote_search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'remote', originalName: 'remote_search' }
      })
      throw new Error('x'.repeat(2_048))
    })

    const output = toolCallRoute.output.parse(
      await fixture.dispatcher.dispatch(
        toolCallRoute.name,
        { target: 'remote_search', arguments: {} },
        agentCaller(),
        operationGrant(context.capability, 'call'),
        new AbortController().signal
      )
    )

    expect(output.step).toMatchObject({
      status: 'error',
      error: { code: 'result_too_large' }
    })
    expect(fixture.commitChildOutcome).toHaveBeenCalledWith(expect.anything(), {
      childOrdinal: 0,
      responseText: 'Programmatic Tool result exceeds its output quota',
      isError: true
    })
  })

  it('fails closed for mismatched callers, grants, and missing live authority', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const { dispatcher, resolveInvocation } = createDispatcher(context)

    await expectCliError(
      dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'remote' },
        agentCaller('another-session'),
        operationGrant(context.capability, 'search'),
        new AbortController().signal
      ),
      'authentication_failed'
    )
    await expectCliError(
      dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'remote' },
        agentCaller(),
        operationGrant(context.capability, 'describe'),
        new AbortController().signal
      ),
      'authentication_failed'
    )
    expect(resolveInvocation).not.toHaveBeenCalled()

    resolveInvocation.mockImplementationOnce(() => {
      throw new Error('authority revoked')
    })
    await expectCliError(
      dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'remote' },
        agentCaller(),
        operationGrant(context.capability, 'search'),
        new AbortController().signal
      ),
      'authentication_failed'
    )
  })

  it('propagates cancellation before consulting process-live authority', async () => {
    const context = buildCapability({
      definitions: [agentExec(), mcpTool({ name: 'remote_search' })]
    })
    const { dispatcher, resolveInvocation } = createDispatcher(context)
    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))

    await expect(
      dispatcher.dispatch(
        toolSearchRoute.name,
        { query: 'remote' },
        agentCaller(),
        operationGrant(context.capability, 'search'),
        controller.signal
      )
    ).rejects.toThrow('cancelled by test')
    expect(resolveInvocation).not.toHaveBeenCalled()
  })
})
