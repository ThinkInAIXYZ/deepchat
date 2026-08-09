import { describe, expect, it, vi } from 'vitest'
import {
  DeferredToolExecutor,
  type DeferredToolExecutorDependencies
} from '@/agent/deepchat/runtime/deferredToolExecutor'
import { ExecutionJournalError } from '@/tape/domain/executionJournal'
import {
  GIT_BASH_COMMAND_SHELL,
  POSIX_COMMAND_SHELL
} from '../../../../helpers/commandShell'

const SESSION_ID = 'session-1'
const MESSAGE_ID = 'message-1'
const TOOL_CALL = {
  id: 'call-1',
  name: 'write_file',
  params: '{"path":"a.txt"}',
  response: '',
  server_name: 'agent-filesystem'
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
  }) => Promise<unknown>
) {
  const order: string[] = []
  const abortController = new AbortController()
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
      loadToolDefinitionsForSession: vi.fn(async () => [
        {
          type: 'function',
          source: 'agent',
          function: { name: 'write_file' },
          server: { name: 'agent-filesystem' }
        }
      ]),
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
        permissionMode: 'full_access'
      }))
    },
    identity: { getAgentId: vi.fn(() => 'deepchat') },
    messageProjection: { updateSubagentToolCallProgress: vi.fn() },
    commandShell: {
      resolveForTurn: vi.fn(async () => POSIX_COMMAND_SHELL),
      resolveProfile: vi.fn(async (profile) =>
        profile === 'git-bash' ? GIT_BASH_COMMAND_SHELL : POSIX_COMMAND_SHELL
      )
    },
    executionJournal
  } as unknown as DeferredToolExecutorDependencies

  const executor = new DeferredToolExecutor(dependencies)
  return {
    abortController,
    dependencies,
    execute: (onToolCallStarted?: () => void) =>
      executor.execute(
        SESSION_ID,
        MESSAGE_ID,
        TOOL_CALL,
        onToolCallStarted,
        'posix'
      ),
    executionJournal,
    executor,
    order
  }
}

describe('DeferredToolExecutor Execution Journal', () => {
  it('commits deferred boundaries before target invocation and result projection', async () => {
    const { dependencies, execute, executionJournal, order } = createHarness()
    const onToolCallStarted = vi.fn(() => order.push('tool.started'))

    await expect(execute(onToolCallStarted)).resolves.toMatchObject({
      responseText: 'done',
      isError: false,
      invoked: true
    })

    expect(order).toEqual([
      'journal.run_started',
      'tool.started',
      'tool.execute',
      'journal.dispatch',
      'target.call',
      'result.normalize',
      'result.prepare',
      'journal.outcome',
      'outcome.projection',
      'journal.terminal'
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
  })

  it('resolves a stored shell profile instead of the current preference', async () => {
    const { dependencies, executor } = createHarness()

    await executor.execute(
      SESSION_ID,
      MESSAGE_ID,
      TOOL_CALL,
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

  it('fails closed for an invalid persisted shell profile', async () => {
    const { dependencies, executor } = createHarness()

    await expect(
      executor.execute(SESSION_ID, MESSAGE_ID, TOOL_CALL, undefined, 'unknown-shell' as never)
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
      executor.execute(SESSION_ID, MESSAGE_ID, unboundToolCall, undefined, 'posix')
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

  it('returns a non-retryable terminal error when T2 persistence fails', async () => {
    const { execute, executionJournal, order } = createHarness()
    executionJournal.commitToolOutcome.mockImplementationOnce(() => {
      order.push('journal.outcome.failed')
      throw new ExecutionJournalError('T2 unavailable', 'persistence_failed')
    })

    await expect(execute()).resolves.toMatchObject({
      isError: true,
      invoked: true,
      terminalError: 'T2 unavailable'
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

  it('does not reach the target when the dispatch commit fails', async () => {
    const { execute, executionJournal, order } = createHarness()
    executionJournal.commitDispatch.mockImplementationOnce(() => {
      order.push('journal.dispatch.failed')
      throw new Error('storage offline')
    })

    await expect(execute()).resolves.toMatchObject({
      isError: true,
      responseText: 'Error: Failed to commit deferred tool dispatch_committed.',
      terminalError: 'Failed to commit deferred tool dispatch_committed.'
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
    const { execute, executionJournal, order } = createHarness()
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
