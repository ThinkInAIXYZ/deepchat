import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_RUNTIME_API_VERSION,
  WORKFLOW_RUNTIME_DEFAULT_LIMITS,
  WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  type WorkflowRuntimeEvent
} from '@shared/workflow/runtimeProtocol'
import {
  WorkflowUtilityProcessHost,
  createWorkflowUtilityEnvironment,
  resolveWorkflowUtilityHostEntryPoint
} from '@/workflow/runtime/workflowUtilityProcessHost'

type Listener = (...args: any[]) => void

class FakeUtilityProcess {
  pid = 4242
  readonly posted: unknown[] = []
  exitOnKill = true
  readonly kill = vi.fn(() => {
    if (this.exitOnKill) {
      this.emit('exit', 0)
    }
  })
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly onceListeners = new Map<string, Set<Listener>>()

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  once(event: string, listener: Listener): this {
    const listeners = this.onceListeners.get(event) ?? new Set()
    listeners.add(listener)
    this.onceListeners.set(event, listeners)
    return this
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    this.onceListeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
    const once = [...(this.onceListeners.get(event) ?? [])]
    this.onceListeners.delete(event)
    for (const listener of once) {
      listener(...args)
    }
  }
}

const startCommand = {
  type: 'START' as const,
  protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
  runtimeApiVersion: WORKFLOW_RUNTIME_API_VERSION,
  runId: 'run-process',
  source: 'return null',
  input: null,
  limits: WORKFLOW_RUNTIME_DEFAULT_LIMITS
}

describe('WorkflowUtilityProcessHost', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for READY and forwards validated commands and events', async () => {
    const process = new FakeUtilityProcess()
    const events: WorkflowRuntimeEvent[] = []
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: (event) => events.push(event),
      onExit: (event) => exits.push(event),
      spawnHost: async () => process as never
    })

    const readyPromise = host.start(startCommand)
    await vi.waitFor(() => expect(process.posted).toEqual([startCommand]))
    process.emit('message', {
      type: 'READY',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-process',
      pid: 4242
    })

    await expect(readyPromise).resolves.toMatchObject({ type: 'READY', pid: 4242 })
    expect(events).toHaveLength(1)

    host.settleInvocation('run-process:1', {
      status: 'success',
      value: 'done'
    })
    expect(process.posted.at(-1)).toMatchObject({
      type: 'SETTLE_INVOCATION',
      requestId: 'run-process:1'
    })

    host.shutdown()
    expect(process.posted.at(-1)).toMatchObject({ type: 'SHUTDOWN' })
    process.emit('exit', 0)
    expect(exits).toEqual([{ runId: 'run-process', code: 0, expected: true }])
  })

  it('kills an invalid child protocol event as an unexpected exit', async () => {
    const process = new FakeUtilityProcess()
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      spawnHost: async () => process as never
    })

    const readyPromise = host.start(startCommand)
    await vi.waitFor(() => expect(process.posted).toHaveLength(1))
    process.emit('message', {
      type: 'READY',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-process',
      pid: 4242
    })
    await readyPromise

    process.emit('message', {
      type: 'COMPLETE',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'another-run',
      value: null
    })

    expect(process.kill).toHaveBeenCalledTimes(1)
    expect(exits).toEqual([{ runId: 'run-process', code: 0, expected: false }])
  })

  it('settles the host lifecycle when a forced kill emits no exit event', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const process = new FakeUtilityProcess()
    process.exitOnKill = false
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      killSettleMs: 100,
      spawnHost: async () => process as never
    })

    const readyPromise = host.start(startCommand)
    await vi.waitFor(() => expect(process.posted).toHaveLength(1))
    process.emit('message', {
      type: 'READY',
      protocolVersion: WORKFLOW_RUNTIME_PROTOCOL_VERSION,
      runId: 'run-process',
      pid: 4242
    })
    await readyPromise

    host.kill()
    expect(exits).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(exits).toEqual([{ runId: 'run-process', code: 0, expected: true }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not emit exit'))

    process.emit('exit', 0)
    expect(exits).toHaveLength(1)
    warn.mockRestore()
  })

  it('reports a terminal exit when process creation fails before a host exists', async () => {
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      spawnHost: async () => {
        throw new Error('spawn unavailable')
      }
    })

    await expect(host.start(startCommand)).rejects.toThrow('spawn unavailable')
    expect(exits).toEqual([{ runId: 'run-process', code: 1, expected: false }])
  })

  it('settles termination and kills a process that finishes spawning afterward', async () => {
    const process = new FakeUtilityProcess()
    process.exitOnKill = false
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    let resolveSpawn!: (process: FakeUtilityProcess) => void
    const spawnPromise = new Promise<FakeUtilityProcess>((resolve) => {
      resolveSpawn = resolve
    })
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      spawnHost: async () => (await spawnPromise) as never
    })

    const startPromise = host.start(startCommand)
    const rejectedStart = expect(startPromise).rejects.toThrow('exited before READY')
    host.kill()
    await rejectedStart
    expect(exits).toEqual([{ runId: 'run-process', code: 0, expected: true }])

    resolveSpawn(process)
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledTimes(1))
    host.kill()
    expect(process.kill).toHaveBeenCalledTimes(1)
    process.emit('exit', 0)
    expect(exits).toEqual([{ runId: 'run-process', code: 0, expected: true }])
  })

  it('applies the READY timeout while the process is still spawning', async () => {
    vi.useFakeTimers()
    const process = new FakeUtilityProcess()
    process.exitOnKill = false
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    let resolveSpawn!: (process: FakeUtilityProcess) => void
    const spawnPromise = new Promise<FakeUtilityProcess>((resolve) => {
      resolveSpawn = resolve
    })
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      readyTimeoutMs: 100,
      spawnHost: async () => (await spawnPromise) as never
    })

    const startPromise = host.start(startCommand)
    const rejectedStart = expect(startPromise).rejects.toThrow(
      'did not become ready before timeout'
    )
    await vi.advanceTimersByTimeAsync(100)
    await rejectedStart
    expect(exits).toEqual([{ runId: 'run-process', code: 1, expected: false }])

    resolveSpawn(process)
    await vi.waitFor(() => expect(process.kill).toHaveBeenCalledOnce())
    expect(process.kill).toHaveBeenCalledOnce()

    process.emit('exit', 1)
    expect(exits).toEqual([{ runId: 'run-process', code: 1, expected: false }])
    vi.useRealTimers()
  })

  it('rejects a READY timeout even when process creation never settles', async () => {
    vi.useFakeTimers()
    const exits: Array<{ runId: string; code: number; expected: boolean }> = []
    const host = new WorkflowUtilityProcessHost({
      runId: 'run-process',
      onEvent: vi.fn(),
      onExit: (event) => exits.push(event),
      readyTimeoutMs: 100,
      spawnHost: async () => await new Promise<never>(() => undefined)
    })

    const startPromise = host.start(startCommand)
    const rejectedStart = expect(startPromise).rejects.toThrow(
      'did not become ready before timeout'
    )
    await vi.advanceTimersByTimeAsync(100)

    await rejectedStart
    expect(exits).toEqual([{ runId: 'run-process', code: 1, expected: false }])
  })

  it('passes only the utility baseline environment', () => {
    expect(
      createWorkflowUtilityEnvironment({
        LANG: 'en_US.UTF-8',
        TMPDIR: '/tmp/workflow',
        HOME: '/private/home',
        OPENAI_API_KEY: 'secret',
        DEEPCHAT_WORKFLOW_UTILITY_HOST: 'stale'
      })
    ).toEqual({
      DEEPCHAT_WORKFLOW_UTILITY_HOST: '1',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp/workflow'
    })
  })

  it('resolves the named build entry from an application path', () => {
    expect(resolveWorkflowUtilityHostEntryPoint('/mock/app')).toBe(
      '/mock/app/out/main/workflowUtilityHost.js'
    )
  })
})
