import { describe, expect, it, vi } from 'vitest'
import {
  DeferredToolExecutor,
  type DeferredToolExecutorDependencies
} from '@/agent/deepchat/runtime/deferredToolExecutor'
import { ExecutionJournalError } from '@/tape/domain/executionJournal'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import { createOpaquePromptAssembly } from '@/agent/deepchat/resources/promptAssembly'
import { buildExecutionContract } from '@/tape/domain/executionContract'
import {
  GIT_BASH_COMMAND_SHELL,
  POSIX_COMMAND_SHELL
} from '../../../../helpers/commandShell'
import {
  attachProgrammaticToolDeferredResumeCapability,
  buildProgrammaticToolCapabilityV1,
  createProgrammaticToolSurfaceRunControllerV1,
  markProgrammaticToolCapabilityProvenanceCommitted
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import {
  buildToolSurfaceDeferredDispatchBinding,
  registerToolSurfaceDeferredDispatch,
  revokeToolSurfaceDeferredDispatchesForSession,
  revokeToolSurfaceExecutionEligibility
} from '@/agent/deepchat/runtime/toolSurface'

const SESSION_ID = 'session-1'
const MESSAGE_ID = 'message-1'
const TOOL_CALL = {
  id: 'call-1',
  name: 'write_file',
  params: '{"path":"a.txt"}',
  response: '',
  server_name: 'agent-filesystem'
}
const CONTRACT_RUN_ID = '11111111-1111-4111-8111-111111111111'
const TOOL_DEFINITION: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  execution: TOOL_EXECUTION.write,
  function: {
    name: TOOL_CALL.name,
    description: 'Write a file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'agent-filesystem', icons: '', description: 'Agent filesystem' }
}

function buildContract() {
  const promptAssembly = createOpaquePromptAssembly('System prompt')
  return buildExecutionContract({
    request: {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      runId: CONTRACT_RUN_ID,
      requestSeq: 3
    },
    promptAssembly,
    providerMessages: [
      { role: 'system', content: promptAssembly.prompt },
      { role: 'user', content: 'Write a.txt' }
    ],
    tools: [TOOL_DEFINITION],
    providerId: 'openai',
    modelId: 'gpt-5',
    modelConfig: {} as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'path', path: '/workspace' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
}

type ToolExecutionOptions = Parameters<
  DeferredToolExecutorDependencies['toolExecutionPort']['execute']
>[1]

function dispatchInput() {
  return {
    toolName: 'write_file',
    toolSource: 'agent' as const,
    normalizedArguments: { path: 'a.txt' },
    target: { serverName: 'agent-filesystem', originalName: 'write_file' }
  }
}

function createHarness(
  executeTool?: (input: {
    options: NonNullable<ToolExecutionOptions>
    abortController: AbortController
    order: string[]
  }) => Promise<unknown>,
  fixture: {
    toolCall?: typeof TOOL_CALL
    toolDefinition?: MCPToolDefinition
    permissionMode?: 'default' | 'full_access'
    programmaticToolParents?: DeferredToolExecutorDependencies['programmaticToolParents']
  } = {}
) {
  const order: string[] = []
  const abortController = new AbortController()
  const toolCall = fixture.toolCall ?? TOOL_CALL
  const toolDefinition = fixture.toolDefinition ?? TOOL_DEFINITION
  let nextEntryId = 1
  const receipt = () => ({ sessionId: SESSION_ID, entryId: nextEntryId++, created: true })
  const executionJournal = {
    commitRunStarted: vi.fn(() => {
      order.push('journal.run_started')
      return receipt()
    }),
    commitDispatch: vi.fn(() => {
      order.push('journal.dispatch')
      return receipt()
    }),
    commitToolOutcome: vi.fn(() => {
      order.push('journal.outcome')
      return receipt()
    }),
    commitRunTerminal: vi.fn(() => {
      order.push('journal.terminal')
      return receipt()
    })
  }
  const dependencies = {
    toolExecutionPort: {
      preCheck: vi.fn(),
      execute: vi.fn(async (_request, options) => {
        order.push('tool.execute')
        if (executeTool) {
          return await executeTool({
            options: options as NonNullable<ToolExecutionOptions>,
            abortController,
            order
          })
        }
        options?.commitDispatch?.(dispatchInput())
        order.push('target.call')
        options?.registerOutcomeProjection?.(() => order.push('outcome.projection'))
        return {
          content: 'done',
          rawData: { content: 'done', isError: false }
        }
      })
    },
    toolResultPort: {
      normalize: vi.fn(async ({ content }) => {
        order.push('result.normalize')
        return content
      }),
      prepare: vi.fn(async ({ rawContent }) => {
        order.push('result.prepare')
        return { kind: 'ok' as const, content: rawContent }
      }),
      fitBatch: vi.fn()
    },
    toolResolver: {
      loadToolDefinitionsForSession: vi.fn(async () => [toolDefinition]),
      getDisabledAgentTools: vi.fn(() => []),
      resolveAgentExtensionPolicy: vi.fn(async () => ({ enabledMcpServerIds: [] })),
      resolveActiveSkillNamesForToolProfile: vi.fn(async () => []),
      toToolDefinitionMcpServerIds: vi.fn(() => [])
    },
    cacheImage: vi.fn(async (data: string) => data),
    runLifecycle: {
      registerDeferredToolController: vi.fn(() => abortController),
      clearDeferredToolController: vi.fn(),
      getAbortSignal: vi.fn(() => undefined)
    },
    sessionSettings: { resolveProjectDir: vi.fn(() => '/workspace') },
    sessionState: {
      get: vi.fn(async () => ({
        providerId: 'openai',
        modelId: 'gpt-5',
        permissionMode: fixture.permissionMode ?? 'full_access'
      }))
    },
    identity: { getAgentId: vi.fn(() => 'deepchat') },
    messageProjection: { updateSubagentToolCallProgress: vi.fn() },
    runJournalObserver: vi.fn(),
    commandShell: {
      resolveForTurn: vi.fn(async () => POSIX_COMMAND_SHELL),
      resolveProfile: vi.fn(async (profile) =>
        profile === 'git-bash' ? GIT_BASH_COMMAND_SHELL : POSIX_COMMAND_SHELL
      )
    },
    executionJournal,
    programmaticToolParents:
      fixture.programmaticToolParents ??
      ({
        prepare: vi.fn(() => {
          throw new Error('Unexpected Programmatic parent preparation')
        }),
        commitRunTerminal: vi.fn(
          (_run: { sessionId: string; runId: string }, commit: () => unknown) => commit()
        )
      } as unknown as DeferredToolExecutorDependencies['programmaticToolParents'])
  } as unknown as DeferredToolExecutorDependencies

  const executor = new DeferredToolExecutor(dependencies)
  return {
    abortController,
    dependencies,
    execute: (onToolCallStarted?: () => void) =>
      executor.execute(
        SESSION_ID,
        MESSAGE_ID,
        toolCall,
        onToolCallStarted,
        undefined,
        'posix'
      ),
    executionJournal,
    executor,
    order
  }
}

function createProgrammaticResumeHarness(input: {
  kind: string
  execArguments: Readonly<{ command: string; stdin?: string }>
}) {
  const execDefinition: MCPToolDefinition = {
    type: 'function',
    source: 'agent',
    execution: TOOL_EXECUTION.write,
    function: {
      name: 'exec',
      description: 'Execute a shell command',
      parameters: { type: 'object', properties: {} }
    },
    server: { name: 'agent-filesystem', icons: '', description: 'Agent filesystem' }
  }
  const hiddenDefinition: MCPToolDefinition = {
    type: 'function',
    source: 'mcp',
    execution: TOOL_EXECUTION.read.parallel,
    function: {
      name: 'remote_search',
      description: 'Search remotely',
      parameters: { type: 'object', properties: {} }
    },
    server: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'remote',
      icons: '',
      description: 'Remote',
      configGeneration: 1,
      bindingHash: 'a'.repeat(64)
    },
    raw: { name: 'remote_search', inputSchema: { type: 'object', properties: {} } }
  }
  const controller = createProgrammaticToolSurfaceRunControllerV1({
    ceilingDefinitions: [execDefinition, hiddenDefinition],
    providerActiveDefinitions: [execDefinition],
    policyVersion: 'programmatic-deferred-test-v1'
  })
  const snapshot = controller.build({
    request: {
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      runId: CONTRACT_RUN_ID,
      requestSeq: 3
    },
    eligibleDefinitions: [execDefinition, hiddenDefinition]
  })
  const capability = buildProgrammaticToolCapabilityV1({
    snapshot,
    taskContractContext: null,
    ceilings: {
      maxToolEffect: 'read',
      workspace: { kind: 'runtime_default' },
      maxSubagentDepth: 0
    },
    quotas: {
      maxChildren: 4,
      maxBatchSteps: 4,
      maxInputBytes: 16_384,
      maxOutputBytes: 16_384,
      maxDurationMs: 30_000
    }
  })
  markProgrammaticToolCapabilityProvenanceCommitted(capability, snapshot)
  controller.admit(snapshot)
  const toolCall = {
    ...TOOL_CALL,
    id: `exec-${input.kind.replace(' ', '-')}-1`,
    name: 'exec',
    params: JSON.stringify(input.execArguments)
  }
  const deferredDispatch = registerToolSurfaceDeferredDispatch({
    snapshot,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    binding: buildToolSurfaceDeferredDispatchBinding({
      snapshot,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      contractBearing: false
    })
  })
  attachProgrammaticToolDeferredResumeCapability(deferredDispatch, capability)
  revokeToolSurfaceExecutionEligibility(snapshot)

  const trustedResponse = '{"tools":[]}\nExit Code: 0'
  const registration = {
    operation: null as never,
    armOuterDispatch: vi.fn(),
    takeArmedToken: vi.fn(() => ({}) as never),
    takeCompletedInvocationResult: vi.fn(() => ({
      responseText: trustedResponse,
      isError: false
    })),
    cancelBeforeOuterDispatch: vi.fn(),
    settleProcessFailure: vi.fn(({ responseText }) => ({
      result: { responseText, isError: true },
      receipt: { sessionId: SESSION_ID, entryId: 3, created: true }
    })),
    settleOuterOutcome: vi.fn(() => ({
      sessionId: SESSION_ID,
      entryId: 3,
      created: true
    }))
  }
  const prepare = vi.fn((parentInput) => {
    registration.operation = parentInput.binding.operation as never
    return registration
  })
  const programmaticToolParents = {
    prepare,
    commitRunTerminal: vi.fn(
      (_run: { sessionId: string; runId: string }, commit: () => unknown) => commit()
    )
  } as unknown as DeferredToolExecutorDependencies['programmaticToolParents']
  const harness = createHarness(
    async ({ options }) => {
      expect(options.programmaticToolCapability).toBe(capability)
      expect(options.programmaticToolParent).toBe(registration)
      expect(options.toolSurfaceDeferredDispatch).toBe(deferredDispatch)
      options.commitDispatch({
        toolName: 'exec',
        toolSource: 'agent',
        normalizedArguments: JSON.parse(toolCall.params),
        target: { serverName: 'agent-filesystem', originalName: 'exec' }
      })
      options.programmaticToolParent?.takeArmedToken()
      return {
        content: 'forged stdout',
        rawData: { content: 'forged stdout', isError: false }
      }
    },
    {
      toolCall,
      toolDefinition: execDefinition,
      permissionMode: 'default',
      programmaticToolParents
    }
  )

  return { deferredDispatch, harness, prepare, registration, toolCall, trustedResponse }
}

describe('DeferredToolExecutor Execution Journal', () => {
  it('commits deferred boundaries before target invocation and result projection', async () => {
    const { dependencies, execute, executionJournal, order } = createHarness()
    const onToolCallStarted = vi.fn(() => order.push('tool.started'))
    vi.mocked(dependencies.runJournalObserver!).mockImplementation((observation) =>
      order.push(`observe.${observation.type}`)
    )

    await expect(execute(onToolCallStarted)).resolves.toMatchObject({
      responseText: 'done',
      isError: false,
      invoked: true
    })

    expect(order).toEqual([
      'journal.run_started',
      'observe.started',
      'tool.started',
      'tool.execute',
      'journal.dispatch',
      'target.call',
      'result.normalize',
      'result.prepare',
      'journal.outcome',
      'outcome.projection',
      'journal.terminal',
      'observe.terminal'
    ])
    expect(dependencies.toolExecutionPort.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ commandShell: POSIX_COMMAND_SHELL })
    )
    const started = executionJournal.commitRunStarted.mock.calls[0][0]
    const dispatch = executionJournal.commitDispatch.mock.calls[0][0]
    const outcome = executionJournal.commitToolOutcome.mock.calls[0][0]
    const terminal = executionJournal.commitRunTerminal.mock.calls[0][0]
    expect(started).toMatchObject({
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      runKind: 'deferred_tool',
      runId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })
    expect(dispatch.operation).toEqual({
      runId: started.runId,
      requestSeq: 1,
      providerToolCallId: TOOL_CALL.id
    })
    expect(outcome.operation).toEqual(dispatch.operation)
    expect(terminal).toMatchObject({
      runId: started.runId,
      outcome: 'completed',
      stopReason: 'tool_result'
    })
    expect(dependencies.programmaticToolParents.commitRunTerminal).toHaveBeenCalledWith(
      { sessionId: SESSION_ID, runId: started.runId },
      expect.any(Function)
    )
  })

  it.each(['start', 'terminal'] as const)(
    'keeps deferred execution durable when the %s diagnostic clock read fails',
    async (failingRead) => {
      const { dependencies, execute, executionJournal } = createHarness()
      dependencies.diagnosticNow =
        failingRead === 'start'
          ? vi.fn(() => {
              throw new Error('clock unavailable')
            })
          : vi
              .fn<() => number>()
              .mockReturnValueOnce(10)
              .mockImplementation(() => {
                throw new Error('clock unavailable')
              })

      await expect(execute()).resolves.toMatchObject({ responseText: 'done', isError: false })

      expect(executionJournal.commitRunStarted).toHaveBeenCalledOnce()
      expect(executionJournal.commitRunTerminal).toHaveBeenCalledOnce()
      const terminalObservation = vi.mocked(dependencies.runJournalObserver!).mock.calls[1][0]
      expect(terminalObservation).toMatchObject({ type: 'terminal', outcome: 'completed' })
      expect(terminalObservation).not.toHaveProperty('durationMs')
    }
  )

  it('uses the originating provider View identity while journaling a distinct deferred run', async () => {
    const { dependencies, executionJournal, executor } = createHarness()
    const executionContract = buildContract()

    await executor.execute(
      SESSION_ID,
      MESSAGE_ID,
      TOOL_CALL,
      undefined,
      executionContract,
      'posix'
    )

    expect(dependencies.toolExecutionPort.execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: CONTRACT_RUN_ID,
        messageId: MESSAGE_ID,
        requestSeq: 3,
        executionContract
      })
    )
    const deferredRunId = executionJournal.commitRunStarted.mock.calls[0][0].runId
    expect(deferredRunId).not.toBe(CONTRACT_RUN_ID)
    expect(executionJournal.commitDispatch.mock.calls[0][0].operation.runId).toBe(deferredRunId)
  })

  it.each([
    {
      kind: 'discovery',
      expectedVerb: 'search',
      execArguments: { command: 'deepchat tool search --query calendar' }
    },
    {
      kind: 'tool call',
      expectedVerb: 'call',
      execArguments: {
        command: 'deepchat tool call',
        stdin: JSON.stringify({ target: 'remote_search', arguments: { query: 'calendar' } })
      }
    }
  ])(
    'resumes a Programmatic $kind approval with a fresh deferred parent and trusted outer result',
    async ({ kind, expectedVerb, execArguments }) => {
      const { deferredDispatch, harness, prepare, registration, toolCall, trustedResponse } =
        createProgrammaticResumeHarness({ kind, execArguments })
      try {
        await expect(
          harness.executor.execute(
            SESSION_ID,
            MESSAGE_ID,
            toolCall,
            undefined,
            undefined,
            'posix',
            'approved-command-grant',
            deferredDispatch
          )
        ).resolves.toMatchObject({ responseText: trustedResponse, isError: false })

        const runId = harness.executionJournal.commitRunStarted.mock.calls[0][0].runId
        expect(runId).not.toBe(CONTRACT_RUN_ID)
        expect(prepare.mock.calls[0][0].binding).toMatchObject({
          command: { verb: expectedVerb },
          operation: {
            runId,
            requestSeq: 1,
            providerToolCallId: toolCall.id
          }
        })
        expect(harness.executionJournal.commitDispatch.mock.calls[0][0].operation).toEqual({
          runId,
          requestSeq: 1,
          providerToolCallId: toolCall.id
        })
        expect(registration.armOuterDispatch).toHaveBeenCalledOnce()
        expect(registration.takeCompletedInvocationResult).toHaveBeenCalledOnce()
        expect(registration.settleOuterOutcome).toHaveBeenCalledWith({
          responseText: trustedResponse,
          isError: false
        })
        expect(harness.executionJournal.commitToolOutcome).not.toHaveBeenCalled()
        expect(harness.executionJournal.commitRunTerminal).toHaveBeenCalledWith(
          expect.objectContaining({ runId, outcome: 'completed', stopReason: 'tool_result' })
        )
      } finally {
        revokeToolSurfaceDeferredDispatchesForSession(SESSION_ID)
      }
    }
  )

  it('resolves a stored shell profile instead of the current preference', async () => {
    const { dependencies, executor } = createHarness()

    await executor.execute(
      SESSION_ID,
      MESSAGE_ID,
      TOOL_CALL,
      undefined,
      undefined,
      'git-bash',
      'command-grant-deferred'
    )

    expect(dependencies.commandShell.resolveProfile).toHaveBeenCalledWith('git-bash')
    expect(dependencies.commandShell.resolveForTurn).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        commandShell: GIT_BASH_COMMAND_SHELL,
        oneShotCommandGrantId: 'command-grant-deferred'
      })
    )
  })

  it('forwards only the granted operation capability to deferred execution', async () => {
    const { dependencies, executor } = createHarness()
    const permissionLease = { kind: 'file' as const, leaseId: 'file-lease-1' }

    await executor.execute(
      SESSION_ID,
      MESSAGE_ID,
      TOOL_CALL,
      undefined,
      undefined,
      'posix',
      undefined,
      undefined,
      undefined,
      permissionLease
    )

    expect(dependencies.toolExecutionPort.execute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ permissionLease })
    )
  })

  it('fails closed for an invalid persisted shell profile', async () => {
    const { dependencies, executor } = createHarness()

    await expect(
      executor.execute(
        SESSION_ID,
        MESSAGE_ID,
        TOOL_CALL,
        undefined,
        undefined,
        'unknown-shell' as never
      )
    ).resolves.toMatchObject({ isError: true, invoked: false })

    expect(dependencies.commandShell.resolveProfile).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveForTurn).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).not.toHaveBeenCalled()
  })

  it('fails closed when deferred Agent filesystem execution lacks a stored shell profile', async () => {
    const { dependencies, executionJournal, executor } = createHarness()

    await expect(executor.execute(SESSION_ID, MESSAGE_ID, TOOL_CALL)).resolves.toMatchObject({
      responseText: 'Deferred file execution is missing its shell profile.',
      isError: true,
      invoked: false
    })

    expect(dependencies.commandShell.resolveProfile).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveForTurn).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).not.toHaveBeenCalled()
    expect(executionJournal.commitRunStarted).not.toHaveBeenCalled()
    expect(executionJournal.commitDispatch).not.toHaveBeenCalled()
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).not.toHaveBeenCalled()
    expect(dependencies.runLifecycle.clearDeferredToolController).toHaveBeenCalledOnce()
  })

  it('fails closed before resolving a deferred tool without a server identity', async () => {
    const { dependencies, executionJournal, executor } = createHarness()
    const { server_name: _serverName, ...unboundToolCall } = TOOL_CALL

    await expect(
      executor.execute(SESSION_ID, MESSAGE_ID, unboundToolCall, undefined, undefined, 'posix')
    ).resolves.toMatchObject({
      responseText: 'Deferred tool execution is missing its server identity.',
      isError: true,
      invoked: false
    })

    expect(dependencies.toolResolver.loadToolDefinitionsForSession).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveProfile).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveForTurn).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).not.toHaveBeenCalled()
    expect(executionJournal.commitRunStarted).not.toHaveBeenCalled()
    expect(dependencies.runLifecycle.clearDeferredToolController).toHaveBeenCalledOnce()
  })

  it('keeps current-shell fallback for an explicitly bound non-filesystem tool', async () => {
    const { dependencies, executor } = createHarness()
    vi.mocked(dependencies.toolResolver.loadToolDefinitionsForSession).mockResolvedValueOnce([
      {
        type: 'function',
        source: 'mcp',
        function: { name: 'echo' },
        server: { name: 'mcp-server' }
      }
    ] as never)

    await executor.execute(SESSION_ID, MESSAGE_ID, {
      ...TOOL_CALL,
      name: 'echo',
      server_name: 'mcp-server'
    })

    expect(dependencies.commandShell.resolveForTurn).toHaveBeenCalledOnce()
    expect(dependencies.commandShell.resolveProfile).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).toHaveBeenCalledOnce()
  })

  it('fails closed when a deferred command grant lacks its stored shell profile', async () => {
    const { dependencies, executionJournal, executor } = createHarness()

    await expect(
      executor.execute(
        SESSION_ID,
        MESSAGE_ID,
        { ...TOOL_CALL, name: 'echo', server_name: 'mcp-server' },
        undefined,
        undefined,
        undefined,
        'command-grant-without-profile'
      )
    ).resolves.toMatchObject({
      responseText: 'Deferred command execution is missing its shell profile.',
      isError: true,
      invoked: false
    })

    expect(dependencies.toolResolver.loadToolDefinitionsForSession).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveProfile).not.toHaveBeenCalled()
    expect(dependencies.commandShell.resolveForTurn).not.toHaveBeenCalled()
    expect(dependencies.toolExecutionPort.execute).not.toHaveBeenCalled()
    expect(executionJournal.commitRunStarted).not.toHaveBeenCalled()
    expect(executionJournal.commitDispatch).not.toHaveBeenCalled()
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).not.toHaveBeenCalled()
    expect(dependencies.runLifecycle.clearDeferredToolController).toHaveBeenCalledOnce()
  })

  it('propagates T2 persistence failure even when the terminal fact commits', async () => {
    const { execute, executionJournal, order } = createHarness()
    executionJournal.commitToolOutcome.mockImplementationOnce(() => {
      order.push('journal.outcome.failed')
      throw new ExecutionJournalError('T2 unavailable', 'persistence_failed')
    })

    await expect(execute()).resolves.toMatchObject({
      isError: true,
      invoked: true,
      journalFailure: {
        error: expect.objectContaining({ message: 'T2 unavailable' }),
        dispatchCommitted: true,
        outcomeCommitted: false
      }
    })

    expect(order).toEqual([
      'journal.run_started',
      'tool.execute',
      'journal.dispatch',
      'target.call',
      'result.normalize',
      'result.prepare',
      'journal.outcome.failed',
      'journal.terminal'
    ])
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', stopReason: 'journal_error' })
    )
  })

  it('propagates T1 persistence failure without reaching the target', async () => {
    const { execute, executionJournal, order } = createHarness()
    executionJournal.commitDispatch.mockImplementationOnce(() => {
      order.push('journal.dispatch.failed')
      throw new Error('storage offline')
    })

    await expect(execute()).resolves.toMatchObject({
      isError: true,
      responseText: 'Tool dispatch was not recorded because Execution Journal persistence failed.',
      journalFailure: {
        error: expect.objectContaining({
          message: 'Failed to commit deferred tool dispatch_committed.'
        }),
        dispatchCommitted: false,
        outcomeCommitted: false
      }
    })

    expect(order).not.toContain('target.call')
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', stopReason: 'journal_error' })
    )
  })

  it('does not claim dispatch when both T1 and terminal persistence fail', async () => {
    const { execute, executionJournal } = createHarness()
    executionJournal.commitDispatch.mockImplementationOnce(() => {
      throw new Error('dispatch storage offline')
    })
    executionJournal.commitRunTerminal.mockImplementationOnce(() => {
      throw new Error('terminal storage offline')
    })

    await expect(execute()).resolves.toMatchObject({
      responseText: 'Tool dispatch was not recorded because Execution Journal persistence failed.',
      isError: true,
      journalFailure: {
        dispatchCommitted: false,
        outcomeCommitted: false
      }
    })

    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
  })

  it('returns a committed outcome only as a non-terminal parked projection', async () => {
    const { dependencies, execute, executionJournal, order } = createHarness()
    executionJournal.commitRunTerminal.mockImplementationOnce(() => {
      order.push('journal.terminal.failed')
      throw new Error('storage offline')
    })

    const result = await execute()

    expect(result).toMatchObject({
      responseText: 'done',
      isError: false,
      journalFailure: {
        error: expect.objectContaining({ message: 'Failed to commit deferred tool run_terminal.' }),
        dispatchCommitted: true,
        outcomeCommitted: true
      }
    })
    expect(result).not.toHaveProperty('terminalError')
    expect(dependencies.runJournalObserver).toHaveBeenCalledOnce()
    expect(dependencies.runJournalObserver).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'started' })
    )

    expect(order).toEqual([
      'journal.run_started',
      'tool.execute',
      'journal.dispatch',
      'target.call',
      'result.normalize',
      'result.prepare',
      'journal.outcome',
      'outcome.projection',
      'journal.terminal.failed'
    ])
  })

  it('pauses a pre-dispatch permission response without fabricating T1 or T2', async () => {
    const { execute, executionJournal } = createHarness(async () => ({
      content: 'approval required',
      rawData: {
        content: 'approval required',
        isError: true,
        requiresPermission: true,
        permissionRequest: { permissionType: 'write', description: 'approval required' }
      }
    }))

    await expect(execute()).resolves.toMatchObject({
      requiresPermission: true,
      isError: true
    })

    expect(executionJournal.commitDispatch).not.toHaveBeenCalled()
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'paused', stopReason: 'interaction' })
    )
  })

  it('records an ordinary pre-dispatch failure as an error terminal without T1 or T2', async () => {
    const { execute, executionJournal } = createHarness(async () => {
      throw new Error('local preflight failed')
    })

    await expect(execute()).resolves.toMatchObject({
      responseText: 'Error: local preflight failed',
      isError: true
    })

    expect(executionJournal.commitDispatch).not.toHaveBeenCalled()
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        stopReason: 'pre_dispatch_error',
        errorMessage: 'local preflight failed'
      })
    )
  })

  it('fails closed when permission is requested after dispatch', async () => {
    const { execute, executionJournal } = createHarness(
      async ({ options, abortController }) => {
        options.commitDispatch?.(dispatchInput())
        abortController.abort()
        return {
          content: 'approval required',
          rawData: {
            content: 'approval required',
            isError: true,
            requiresPermission: true,
            permissionRequest: { permissionType: 'write', description: 'approval required' }
          }
        }
      }
    )

    await expect(execute()).resolves.toMatchObject({
      isError: true,
      terminalError: expect.stringContaining('requested permission after dispatch')
    })

    expect(executionJournal.commitToolOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ isError: true })
    )
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error', stopReason: 'post_dispatch_permission' })
    )
  })

  it('leaves T1 indeterminate when aborted before a target result is known', async () => {
    const { execute, executionJournal } = createHarness(
      async ({ options, abortController }) => {
        options.commitDispatch?.(dispatchInput())
        abortController.abort()
        const error = new Error('Aborted')
        error.name = 'AbortError'
        throw error
      }
    )

    await expect(execute()).rejects.toMatchObject({
      name: 'AbortError'
    })

    expect(executionJournal.commitDispatch).toHaveBeenCalledOnce()
    expect(executionJournal.commitToolOutcome).not.toHaveBeenCalled()
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'aborted', stopReason: 'user_stop' })
    )
  })

  it('commits a returned result before recording a later local abort', async () => {
    const { abortController, dependencies, execute, executionJournal, order } = createHarness()
    vi.mocked(dependencies.toolResultPort.normalize).mockImplementationOnce(async () => {
      abortController.abort()
      const error = new Error('Aborted')
      error.name = 'AbortError'
      throw error
    })

    await expect(execute()).rejects.toMatchObject({
      name: 'AbortError'
    })

    expect(order).toContain('journal.outcome')
    expect(executionJournal.commitToolOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        responseText: 'done',
        isError: false
      })
    )
    expect(executionJournal.commitRunTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'aborted', stopReason: 'user_stop' })
    )
  })
})
