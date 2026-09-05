import type { HookEvent } from '@/hook/events'
import type { HookObserver } from '@/hook/observer'
import { RuntimeHookSink } from '@/agent/deepchat/runtime/runtimeHookSink'
import type { DeepChatSessionState } from '@shared/types/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'

const STATE: DeepChatSessionState = {
  status: 'idle',
  providerId: 'openai',
  modelId: 'gpt-5',
  permissionMode: 'full_access'
}

function createHarness(observed = true) {
  const events: HookEvent[] = []
  const observer: HookObserver = {
    isObserved: vi.fn(() => observed),
    notify: vi.fn((event: HookEvent) => events.push(event))
  }
  const getAgentId = vi.fn().mockReturnValue('agent-id')
  const resolveProjectDir = vi.fn().mockReturnValue('/workspace')
  const onSessionCompleted = vi.fn()
  const sink = new RuntimeHookSink({
    observer,
    onSessionCompleted,
    identity: { getAgentId },
    sessionSettings: { resolveProjectDir }
  })
  return { events, getAgentId, observer, onSessionCompleted, resolveProjectDir, sink }
}

describe('RuntimeHookSink scope', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds the session envelope once for every event it emits', () => {
    const { events, resolveProjectDir, sink } = createHarness()
    const hooks = sink.scope({
      sessionId: 'session',
      messageId: 'message',
      providerId: 'openai',
      modelId: 'gpt-5'
    })

    hooks.emit({ event: 'UserPromptSubmit', promptPreview: 'prompt' })
    hooks.emit({ event: 'PreToolUse', tool: { callId: 'call-1', name: 'read_file' } })

    expect(resolveProjectDir).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      {
        event: 'UserPromptSubmit',
        promptPreview: 'prompt',
        session: {
          sessionId: 'session',
          messageId: 'message',
          providerId: 'openai',
          modelId: 'gpt-5',
          projectDir: '/workspace',
          agentId: 'agent-id'
        }
      },
      {
        event: 'PreToolUse',
        tool: { callId: 'call-1', name: 'read_file' },
        session: {
          sessionId: 'session',
          messageId: 'message',
          providerId: 'openai',
          modelId: 'gpt-5',
          projectDir: '/workspace',
          agentId: 'agent-id'
        }
      }
    ])
  })

  it('keeps an explicit project directory instead of resolving one', () => {
    const { events, resolveProjectDir, sink } = createHarness()

    sink.scope({ sessionId: 'session', projectDir: null }).emit({ event: 'SessionStart' })

    expect(resolveProjectDir).not.toHaveBeenCalled()
    expect(events[0].session.projectDir).toBeNull()
  })

  it('assembles nothing when the event has no subscriber', () => {
    const { events, getAgentId, resolveProjectDir, sink } = createHarness(false)

    sink.scope({ sessionId: 'session' }).emit({ event: 'SessionStart' })

    expect(events).toEqual([])
    expect(resolveProjectDir).not.toHaveBeenCalled()
    expect(getAgentId).not.toHaveBeenCalled()
  })

  it('falls back to the deepchat agent identity', () => {
    const { events, getAgentId, sink } = createHarness()
    getAgentId.mockReturnValue(undefined)

    sink.scope({ sessionId: 'session' }).emit({ event: 'SessionStart' })

    expect(events[0].session.agentId).toBe('deepchat')
  })

  it('isolates an observer failure from the caller', () => {
    const { observer, sink } = createHarness()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(observer.notify).mockImplementationOnce(() => {
      throw new Error('observer failed')
    })

    expect(() => sink.scope({ sessionId: 'session' }).emit({ event: 'SessionStart' })).not.toThrow()
    expect(warning).toHaveBeenCalledWith(
      '[DeepChatAgent] Failed to dispatch SessionStart hook:',
      expect.objectContaining({ message: 'observer failed' })
    )
  })

  it('still reports a terminal pair when the project directory cannot be resolved', () => {
    const { events, resolveProjectDir, sink } = createHarness()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resolveProjectDir.mockImplementation(() => {
      throw new Error('stale instance')
    })

    expect(() => sink.observeTerminal('session', STATE, { status: 'completed' })).not.toThrow()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.event)).toEqual(['Stop', 'SessionEnd'])
    expect(events[0].session.projectDir).toBeUndefined()
  })
})

describe('RuntimeHookSink terminal projection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('notifies successful turns even when no command hooks are configured', () => {
    const { events, sink, onSessionCompleted } = createHarness(false)

    sink.observeTerminal('native', STATE, { status: 'completed' })
    sink.scope({ sessionId: 'acp', providerId: 'acp' }).terminal({
      completed: true,
      reason: 'complete',
      userStop: false
    })
    sink.observeTerminal('paused', STATE, { status: 'paused' })
    sink.observeTerminal('aborted', STATE, { status: 'aborted' })
    sink.observeTerminal('failed', STATE, { status: 'error' })
    sink.observeTerminal('tool-error', STATE, {
      status: 'completed',
      terminalError: 'Tool failed'
    })

    expect(onSessionCompleted.mock.calls).toEqual([['native'], ['acp']])
    expect(events).toEqual([])
  })

  it('isolates completion notification failures from turn settlement', () => {
    const { sink, onSessionCompleted } = createHarness(false)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onSessionCompleted.mockImplementation(() => {
      throw new Error('Notification unavailable')
    })

    expect(() => sink.observeTerminal('session', STATE, { status: 'completed' })).not.toThrow()
  })

  it('maps a completed result to Stop then SessionEnd', () => {
    const { events, sink } = createHarness()

    sink.observeTerminal('session', STATE, {
      status: 'completed',
      stopReason: 'tool_calls_complete',
      usage: { totalTokens: 12 }
    })

    expect(events).toEqual([
      {
        event: 'Stop',
        stop: { reason: 'tool_calls_complete', userStop: false },
        session: {
          sessionId: 'session',
          messageId: undefined,
          providerId: 'openai',
          modelId: 'gpt-5',
          projectDir: '/workspace',
          agentId: 'agent-id'
        }
      },
      {
        event: 'SessionEnd',
        usage: { totalTokens: 12 },
        error: null,
        session: {
          sessionId: 'session',
          messageId: undefined,
          providerId: 'openai',
          modelId: 'gpt-5',
          projectDir: '/workspace',
          agentId: 'agent-id'
        }
      }
    ])
  })

  it('maps abort and error fallbacks while ignoring paused results', () => {
    const { events, sink } = createHarness()

    sink.observeTerminal('session', STATE, { status: 'paused' })
    sink.observeTerminal('session', STATE, { status: 'aborted' })
    sink.observeTerminal('session', STATE, {
      status: 'error',
      terminalError: 'provider failed'
    })

    expect(
      events.map((event) => ({
        event: event.event,
        stop: 'stop' in event ? event.stop : undefined,
        error: 'error' in event ? event.error : undefined
      }))
    ).toEqual([
      { event: 'Stop', stop: { reason: 'user_stop', userStop: true }, error: undefined },
      { event: 'SessionEnd', stop: undefined, error: null },
      { event: 'Stop', stop: { reason: 'error', userStop: false }, error: undefined },
      { event: 'SessionEnd', stop: undefined, error: { message: 'provider failed' } }
    ])
  })

  it('skips terminal projection without session state', () => {
    const { events, sink } = createHarness()

    sink.observeTerminal('session', undefined, { status: 'completed' })

    expect(events).toEqual([])
  })

  it('reports the same terminal pair for every entry point', () => {
    const { events, sink } = createHarness()

    sink.scope({ sessionId: 'session', providerId: 'openai', modelId: 'gpt-5' }).terminal({
      reason: 'tool_error',
      userStop: false,
      usage: { totalTokens: 5 },
      error: { message: 'tool exploded' }
    })

    expect(events.map((event) => event.event)).toEqual(['Stop', 'SessionEnd'])
    expect(events[1]).toMatchObject({ usage: { totalTokens: 5 }, error: { message: 'tool exploded' } })
  })

  it('normalizes a missing usage or error into an explicit null', () => {
    const { events, sink } = createHarness()

    sink.scope({ sessionId: 'session' }).terminal({ reason: 'complete', userStop: false })

    expect(events[1]).toMatchObject({ usage: null, error: null })
  })
})

describe('RuntimeHookSink tool observer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes loop tool notifications with the bound session envelope', () => {
    const { events, sink } = createHarness()
    const observer = sink
      .scope({ sessionId: 'session', messageId: 'message', providerId: 'openai' })
      .toolObserver()

    observer.notify({
      event: 'PostToolUseFailure',
      tool: { callId: 'call-1', name: 'write_file', error: 'denied' }
    })
    observer.notify({
      event: 'PermissionRequest',
      tool: { callId: 'call-2', name: 'write_file' },
      permission: { permissionType: 'write' }
    })

    expect(events).toEqual([
      {
        event: 'PostToolUseFailure',
        tool: { callId: 'call-1', name: 'write_file', error: 'denied' },
        session: expect.objectContaining({ sessionId: 'session', messageId: 'message' })
      },
      {
        event: 'PermissionRequest',
        tool: { callId: 'call-2', name: 'write_file' },
        permission: { permissionType: 'write' },
        session: expect.objectContaining({ sessionId: 'session', messageId: 'message' })
      }
    ])
  })

  it('reports subscription state through to the loop', () => {
    const { sink } = createHarness(false)
    const observer = sink.scope({ sessionId: 'session' }).toolObserver()

    expect(observer.isObserved('PreToolUse')).toBe(false)
  })
})
