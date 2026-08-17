import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type ToolDispatchCommitInput
} from '@shared/types/mcp'
import { RUN_CODE_PROTOCOL_VERSION, type RunCodeParentMessage } from '@shared/codeModeProtocol'
import {
  RunCodeRuntimeManager,
  type RunCodeNestedExecutionInput,
  type RunCodeRuntimeManagerOptions
} from '@/tool/codeMode/runCodeRuntimeManager'

class FakeUtilityProcess extends EventEmitter {
  readonly pid = 42
  readonly messages: RunCodeParentMessage[] = []
  readonly kill = vi.fn(() => true)

  constructor(private readonly completeOnStart: boolean) {
    super()
  }

  becomeReady(): void {
    this.emit('message', {
      type: 'READY',
      version: RUN_CODE_PROTOCOL_VERSION,
      pid: this.pid
    })
  }

  postMessage(message: RunCodeParentMessage): void {
    this.messages.push(message)
    if (message.type === 'START' && this.completeOnStart) {
      queueMicrotask(() => {
        this.emit('message', {
          type: 'RESULT',
          version: RUN_CODE_PROTOCOL_VERSION,
          cellId: message.cellId,
          output: ['from console'],
          returnValue: { ok: true },
          store: { remembered: 'value' }
        })
      })
    }
    if (message.type === 'STOP') {
      queueMicrotask(() => this.emit('exit', 0))
    }
  }
}

const tool = (
  name: string,
  execution: MCPToolDefinition['execution'] = TOOL_EXECUTION.write
): MCPToolDefinition => ({
  execution,
  source: 'agent',
  type: 'function',
  function: {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} }
  },
  server: {
    name: 'test',
    icons: '',
    description: 'Test tools'
  }
})

const outerDispatch = (toolName = 'run_code'): ToolDispatchCommitInput => ({
  toolName,
  toolSource: 'agent',
  normalizedArguments: { code: 'return true' },
  target: { serverName: 'agent-code-mode', originalName: toolName }
})

const createManager = (
  host: FakeUtilityProcess,
  executeNested: RunCodeRuntimeManagerOptions['executeNested'] = vi.fn(async () => ({
    content: 'nested result',
    rawData: { content: 'nested result' }
  }))
) =>
  new RunCodeRuntimeManager({
    executeNested,
    spawnHost: async () => {
      setTimeout(() => host.becomeReady(), 0)
      return host
    }
  })

describe('RunCodeRuntimeManager', () => {
  it('rejects partial execution-journal capability wiring before starting a cell', async () => {
    const host = new FakeUtilityProcess(false)
    const manager = createManager(host)

    await expect(
      manager.execute({
        sessionId: 'session-1',
        toolCallId: 'call-1',
        frontend: 'function',
        source: 'return true',
        executionCatalog: [tool('exec')],
        outerDispatch: outerDispatch(),
        options: { commitDispatch: vi.fn() }
      })
    ).rejects.toThrow('complete outer and nested journal capabilities')

    expect(host.messages).toEqual([])
    await manager.shutdown()
  })

  it('returns completion and releases every utility-process listener', async () => {
    const host = new FakeUtilityProcess(true)
    const manager = createManager(host)

    await expect(
      manager.execute({
        sessionId: 'session-1',
        toolCallId: 'call-1',
        frontend: 'function',
        source: 'return { ok: true }',
        executionCatalog: [tool('exec')],
        outerDispatch: outerDispatch(),
        options: {}
      })
    ).resolves.toEqual({ content: 'from console\n{\n  "ok": true\n}' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.messages.map((message) => message.type)).toEqual(['START', 'STOP'])
    expect(host.listenerCount('message')).toBe(0)
    expect(host.listenerCount('exit')).toBe(0)
    expect(host.listenerCount('error')).toBe(0)
    expect(host.kill).not.toHaveBeenCalled()
    await manager.shutdown()
  })

  it('yields a long Codex cell and terminates it through wait', async () => {
    const host = new FakeUtilityProcess(false)
    const manager = createManager(host)
    const yielded = await manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'codex',
      source: 'await new Promise(() => {})',
      yieldTimeMs: 5,
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch('exec'),
      options: {}
    })
    const cellId = yielded.content.match(/cell ID ([\w-]+)/)?.[1]

    expect(cellId).toBeTruthy()
    await expect(
      manager.wait({
        sessionId: 'session-1',
        cellId: cellId!,
        toolCallId: 'wait-1',
        yieldTimeMs: 5,
        maxTokens: 1_000,
        terminate: true,
        outerDispatch: outerDispatch('wait'),
        options: {}
      })
    ).resolves.toEqual({ content: `Code cell ${cellId} was terminated.` })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.messages.at(-1)).toMatchObject({ type: 'STOP', cellId })
    expect(host.listenerCount('message')).toBe(0)
    expect(host.kill).not.toHaveBeenCalled()
    await manager.shutdown()
  })

  it('expires unresolved async execution despite healthy heartbeats', async () => {
    vi.useFakeTimers()
    try {
      const host = new FakeUtilityProcess(false)
      Object.defineProperty(host, 'pid', { value: 0 })
      const manager = createManager(host)
      const execution = manager.execute({
        sessionId: 'session-1',
        toolCallId: 'call-1',
        frontend: 'function',
        source: 'await new Promise(() => {})',
        executionCatalog: [tool('exec')],
        outerDispatch: outerDispatch(),
        options: {}
      })
      const executionFailure = expect(execution).rejects.toThrow(
        'Code cell execution deadline exceeded.'
      )
      await vi.advanceTimersByTimeAsync(0)
      const start = host.messages.find(
        (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
          message.type === 'START'
      )!

      const heartbeat = setInterval(() => {
        host.emit('message', {
          type: 'HEARTBEAT',
          version: RUN_CODE_PROTOCOL_VERSION,
          cellId: start.cellId,
          now: Date.now()
        })
      }, 1_000)
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
      clearInterval(heartbeat)

      await executionFailure
      expect(host.messages).toContainEqual(
        expect.objectContaining({
          type: 'STOP',
          cellId: start.cellId,
          reason: 'Code cell execution deadline exceeded.'
        })
      )
      await manager.shutdown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('normalizes Codex binding names and serializes mutating tools', async () => {
    const host = new FakeUtilityProcess(true)
    const manager = createManager(host)

    await manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'codex',
      source: 'return true',
      executionCatalog: [
        tool('mcp/read-file', TOOL_EXECUTION.read.parallel),
        tool('write-file', TOOL_EXECUTION.write)
      ],
      outerDispatch: outerDispatch('exec'),
      options: {}
    })
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )

    expect(start?.bindings).toEqual([
      expect.objectContaining({ name: 'mcp_read_file', execution: 'parallel' }),
      expect.objectContaining({ name: 'write_file', execution: 'sequential' })
    ])
    await manager.shutdown()
  })

  it('returns structured MCP output to the code cell when available', async () => {
    const host = new FakeUtilityProcess(false)
    const manager = createManager(
      host,
      vi.fn(async () => ({
        content: [{ type: 'text', text: 'rendered fallback' }],
        rawData: {
          toolCallId: 'nested-1',
          content: [{ type: 'text', text: 'rendered fallback' }],
          structuredContent: { answer: 42 }
        }
      }))
    )
    const execution = manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function',
      source: 'return await tools.lookup({})',
      executionCatalog: [tool('lookup')],
      outerDispatch: outerDispatch(),
      options: {}
    })
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: {}
    })
    await vi.waitFor(() =>
      expect(
        host.messages.some(
          (message) =>
            message.type === 'NESTED_RESULT' &&
            message.callId === 'nested-1' &&
            message.result &&
            typeof message.result === 'object' &&
            'answer' in message.result
        )
      ).toBe(true)
    )
    host.emit('message', {
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      output: [],
      returnValue: { answer: 42 },
      store: {}
    })

    await expect(execution).resolves.toMatchObject({ content: expect.stringContaining('42') })
    await manager.shutdown()
  })

  it('sends nested tool failures to the code cell as rejected envelopes', async () => {
    const host = new FakeUtilityProcess(false)
    const manager = createManager(
      host,
      vi.fn(async () => ({
        content: 'nested failure',
        rawData: { content: 'nested failure', isError: true }
      }))
    )
    const execution = manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function',
      source: 'return await tools.lookup({})',
      executionCatalog: [tool('lookup')],
      outerDispatch: outerDispatch(),
      options: {}
    })
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: {}
    })
    await vi.waitFor(() =>
      expect(
        host.messages.some(
          (message) =>
            message.type === 'NESTED_RESULT' &&
            message.callId === 'nested-1' &&
            !message.ok &&
            message.error === 'nested failure'
        )
      ).toBe(true)
    )

    manager.cancelSession('session-1', 'test complete')
    await expect(execution).rejects.toThrow('test complete')
    await manager.shutdown()
  })

  it('journals the outer dispatch and each nested mutation separately', async () => {
    const host = new FakeUtilityProcess(false)
    const commitDispatch = vi.fn()
    const commitNestedDispatch = vi.fn()
    const commitNestedToolOutcome = vi.fn()
    const executeNested = vi.fn(async (input: RunCodeNestedExecutionInput) => {
      input.options.commitDispatch?.({
        toolName: input.definition.function.name,
        toolSource: 'agent',
        normalizedArguments: input.arguments as Record<string, unknown>,
        target: { serverName: 'test', originalName: input.definition.function.name }
      })
      return {
        content: 'done',
        rawData: { toolCallId: input.callId, content: 'done' }
      }
    })
    const manager = createManager(host, executeNested)
    const execution = manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function',
      source: 'await tools.exec({ command: "first" }); await tools.exec({ command: "second" })',
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch(),
      options: { commitDispatch, commitNestedDispatch, commitNestedToolOutcome }
    })
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    for (const [index, command] of ['first', 'second'].entries()) {
      host.emit('message', {
        type: 'NESTED_CALL',
        version: RUN_CODE_PROTOCOL_VERSION,
        cellId: start.cellId,
        callId: `nested-${index + 1}`,
        bindingId: start.bindings[0].id,
        arguments: { command }
      })
      await vi.waitFor(() =>
        expect(host.messages.filter((message) => message.type === 'NESTED_RESULT')).toHaveLength(
          index + 1
        )
      )
    }

    host.emit('message', {
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      output: [],
      store: {}
    })

    await expect(execution).resolves.toEqual({
      content: '(run_code completed with no output)'
    })
    expect(executeNested).toHaveBeenCalledTimes(2)
    expect(commitDispatch).toHaveBeenCalledOnce()
    expect(commitDispatch).toHaveBeenCalledWith(outerDispatch())
    expect(commitNestedDispatch).toHaveBeenCalledTimes(2)
    expect(commitNestedDispatch.mock.calls.map(([input]) => input.childOrdinal)).toEqual([0, 1])
    expect(commitNestedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'exec',
        normalizedArguments: { command: 'first' },
        definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        capabilityHash: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    )
    expect(commitNestedToolOutcome.mock.calls.map(([input]) => input.childOrdinal)).toEqual([0, 1])
    await manager.shutdown()
  })

  it('journals nested calls after wait under the resumed outer call', async () => {
    const host = new FakeUtilityProcess(false)
    const commitDispatch = vi.fn()
    const commitNestedDispatch = vi.fn()
    const commitNestedToolOutcome = vi.fn()
    const executeNested = vi.fn(async (input: RunCodeNestedExecutionInput) => {
      input.options.commitDispatch?.({
        toolName: input.definition.function.name,
        toolSource: 'agent',
        normalizedArguments: input.arguments as Record<string, unknown>,
        target: { serverName: 'test', originalName: input.definition.function.name }
      })
      return { content: 'done', rawData: { content: 'done' } }
    })
    const manager = createManager(host, executeNested)
    const yielded = await manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'codex',
      source: 'await yield_control(); return await tools.exec({ command: "after wait" })',
      yieldTimeMs: 5,
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch('exec'),
      options: { commitDispatch, commitNestedDispatch, commitNestedToolOutcome }
    })
    const cellId = yielded.content.match(/cell ID ([\w-]+)/)?.[1]
    expect(cellId).toBeTruthy()
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!
    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-after-wait',
      bindingId: start.bindings[0].id,
      arguments: { command: 'after wait' }
    })
    host.emit('message', {
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      output: [],
      returnValue: 'done',
      store: {}
    })
    expect(commitNestedDispatch).not.toHaveBeenCalled()

    const waiting = manager.wait({
      sessionId: 'session-1',
      cellId: cellId!,
      toolCallId: 'wait-1',
      yieldTimeMs: 1_000,
      maxTokens: 1_000,
      terminate: false,
      outerDispatch: outerDispatch('wait'),
      options: { commitDispatch, commitNestedDispatch, commitNestedToolOutcome }
    })

    await expect(waiting).resolves.toMatchObject({ content: expect.stringContaining('done') })
    expect(commitDispatch.mock.calls.map(([input]) => input.toolName)).toEqual(['exec', 'wait'])
    expect(commitNestedDispatch).toHaveBeenCalledOnce()
    await manager.shutdown()
  })

  it('waits for in-flight nested outcomes before settling the outer call', async () => {
    const host = new FakeUtilityProcess(false)
    let finishNested!: () => void
    const nestedPending = new Promise<void>((resolve) => {
      finishNested = resolve
    })
    const commitDispatch = vi.fn()
    const commitNestedDispatch = vi.fn()
    const commitNestedToolOutcome = vi.fn()
    const executeNested = vi.fn(async (input: RunCodeNestedExecutionInput) => {
      input.options.commitDispatch?.({
        toolName: input.definition.function.name,
        toolSource: 'agent',
        normalizedArguments: input.arguments as Record<string, unknown>,
        target: { serverName: 'test', originalName: input.definition.function.name }
      })
      await nestedPending
      return { content: 'done', rawData: { content: 'done' } }
    })
    const manager = createManager(host, executeNested)
    const execution = manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function',
      source: 'void tools.exec({ command: "write" }); return true',
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch(),
      options: { commitDispatch, commitNestedDispatch, commitNestedToolOutcome }
    })
    let settled = false
    void execution.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: { command: 'write' }
    })
    await vi.waitFor(() => expect(commitNestedDispatch).toHaveBeenCalledOnce())
    host.emit('message', {
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      output: [],
      returnValue: true,
      store: {}
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    finishNested()
    await expect(execution).resolves.toEqual({ content: 'true' })
    expect(commitNestedToolOutcome).toHaveBeenCalledOnce()
    await manager.shutdown()
  })

  it('retries a nested permission request in the same code cell', async () => {
    const host = new FakeUtilityProcess(false)
    const executeNested = vi
      .fn<RunCodeRuntimeManagerOptions['executeNested']>()
      .mockResolvedValueOnce({
        content: 'permission required',
        rawData: {
          content: 'permission required',
          requiresPermission: true,
          permissionRequest: {
            toolName: 'exec',
            permissionType: 'command',
            command: 'git status --short'
          }
        }
      })
      .mockResolvedValueOnce({
        content: 'clean',
        rawData: { content: 'clean' }
      })
    const manager = createManager(host, executeNested)
    const input = {
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function' as const,
      source: 'return await tools.exec({ command: "git status --short" })',
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch(),
      options: {}
    }
    const firstExecution = manager.execute(input)
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: { command: 'git status --short' }
    })

    await expect(firstExecution).resolves.toMatchObject({
      rawData: { requiresPermission: true }
    })

    const retriedExecution = manager.execute({
      ...input,
      options: { oneShotCommandGrantId: 'grant-1' }
    })
    await vi.waitFor(() => expect(executeNested).toHaveBeenCalledTimes(2))
    expect(executeNested.mock.calls[1][0].options.oneShotCommandGrantId).toBe('grant-1')
    await vi.waitFor(() =>
      expect(
        host.messages.some(
          (message) =>
            message.type === 'NESTED_RESULT' && message.callId === 'nested-1' && message.ok
        )
      ).toBe(true)
    )

    host.emit('message', {
      type: 'RESULT',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      output: [],
      returnValue: 'clean',
      store: {}
    })

    await expect(retriedExecution).resolves.toEqual({ content: 'clean' })
    await manager.shutdown()
  })

  it('rejects a nested tool failure returned after permission retry', async () => {
    const host = new FakeUtilityProcess(false)
    const executeNested = vi
      .fn<RunCodeRuntimeManagerOptions['executeNested']>()
      .mockResolvedValueOnce({
        content: 'permission required',
        rawData: {
          content: 'permission required',
          requiresPermission: true,
          permissionRequest: {
            toolName: 'exec',
            permissionType: 'command',
            command: 'git status --short'
          }
        }
      })
      .mockResolvedValueOnce({
        content: 'nested failure',
        rawData: { content: 'nested failure', isError: true }
      })
    const manager = createManager(host, executeNested)
    const input = {
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function' as const,
      source: 'return await tools.exec({ command: "git status --short" })',
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch(),
      options: {}
    }
    const firstExecution = manager.execute(input)
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!

    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: { command: 'git status --short' }
    })
    await expect(firstExecution).resolves.toMatchObject({
      rawData: { requiresPermission: true }
    })

    const retriedExecution = manager.execute({
      ...input,
      options: { oneShotCommandGrantId: 'grant-1' }
    })
    await vi.waitFor(() =>
      expect(
        host.messages.some(
          (message) =>
            message.type === 'NESTED_RESULT' &&
            message.callId === 'nested-1' &&
            !message.ok &&
            message.error === 'nested failure'
        )
      ).toBe(true)
    )

    host.emit('message', {
      type: 'ERROR',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      error: 'nested failure',
      output: []
    })
    await expect(retriedExecution).rejects.toThrow('nested failure')
    await manager.shutdown()
  })

  it('expires a code cell left waiting for permission', async () => {
    vi.useFakeTimers()
    try {
      const host = new FakeUtilityProcess(false)
      Object.defineProperty(host, 'pid', { value: 0 })
      const executeNested = vi.fn(async () => ({
        content: 'permission required',
        rawData: {
          content: 'permission required',
          requiresPermission: true,
          permissionRequest: {
            toolName: 'exec',
            permissionType: 'command' as const,
            command: 'git status --short'
          }
        }
      }))
      const manager = createManager(host, executeNested)
      const execution = manager.execute({
        sessionId: 'session-1',
        toolCallId: 'call-1',
        frontend: 'function',
        source: 'return await tools.exec({ command: "git status --short" })',
        executionCatalog: [tool('exec')],
        outerDispatch: outerDispatch(),
        options: {}
      })
      await vi.advanceTimersByTimeAsync(0)
      const start = host.messages.find(
        (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
          message.type === 'START'
      )!
      expect(start).toBeDefined()

      host.emit('message', {
        type: 'NESTED_CALL',
        version: RUN_CODE_PROTOCOL_VERSION,
        cellId: start.cellId,
        callId: 'nested-1',
        bindingId: start.bindings[0].id,
        arguments: { command: 'git status --short' }
      })
      await expect(execution).resolves.toMatchObject({
        rawData: { requiresPermission: true }
      })

      const heartbeat = setInterval(() => {
        host.emit('message', {
          type: 'HEARTBEAT',
          version: RUN_CODE_PROTOCOL_VERSION,
          cellId: start.cellId,
          now: Date.now()
        })
      }, 1_000)
      await vi.advanceTimersByTimeAsync(60_001)
      clearInterval(heartbeat)

      expect(host.messages).toContainEqual(
        expect.objectContaining({
          type: 'STOP',
          cellId: start.cellId,
          reason: 'Code cell permission lease expired.'
        })
      )
      await manager.shutdown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight nested call when its session is cancelled', async () => {
    const host = new FakeUtilityProcess(false)
    let nestedSignal: AbortSignal | undefined
    const executeNested = vi.fn(
      async (input: RunCodeNestedExecutionInput) =>
        await new Promise<never>((_resolve, reject) => {
          nestedSignal = input.options.signal
          input.options.signal?.addEventListener(
            'abort',
            () => reject(input.options.signal?.reason),
            { once: true }
          )
        })
    )
    const manager = createManager(host, executeNested)
    const execution = manager.execute({
      sessionId: 'session-1',
      toolCallId: 'call-1',
      frontend: 'function',
      source: 'return await tools.exec({ command: "pwd" })',
      executionCatalog: [tool('exec')],
      outerDispatch: outerDispatch(),
      options: {}
    })
    await vi.waitFor(() =>
      expect(host.messages.some((message) => message.type === 'START')).toBe(true)
    )
    const start = host.messages.find(
      (message): message is Extract<RunCodeParentMessage, { type: 'START' }> =>
        message.type === 'START'
    )!
    host.emit('message', {
      type: 'NESTED_CALL',
      version: RUN_CODE_PROTOCOL_VERSION,
      cellId: start.cellId,
      callId: 'nested-1',
      bindingId: start.bindings[0].id,
      arguments: { command: 'pwd' }
    })
    await vi.waitFor(() => expect(executeNested).toHaveBeenCalledOnce())

    manager.cancelSession('session-1', 'test cancellation')

    await expect(execution).rejects.toThrow('test cancellation')
    expect(nestedSignal?.aborted).toBe(true)
    await manager.shutdown()
  })
})
