import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HookCommandItem,
  HookEventName,
  HookEventPayload,
  HooksNotificationsSettings
} from '../../../src/shared/hooksNotifications'
import { DEFAULT_IMPORTANT_HOOK_EVENTS } from '../../../src/shared/hooksNotifications'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('child_process', () => ({ spawn: spawnMock }))

import { expandHookCommandPlaceholders, HookService, truncateText } from '../../../src/main/hook'
import {
  createDefaultHookCommand,
  createDefaultHooksNotificationsConfig,
  normalizeHooksNotificationsConfig
} from '../../../src/main/hook/config'
import type { HookEvent } from '../../../src/main/hook/events'

describe('HookService helpers', () => {
  it('truncateText keeps short strings intact', () => {
    expect(truncateText('hello', 10)).toBe('hello')
  })

  it('truncateText truncates with suffix', () => {
    const result = truncateText('abcdefghijklmnopqrstuvwxyz', 20)
    expect(result.endsWith(' ...(truncated)')).toBe(true)
    expect(result.length).toBe(20)
  })

  it('expandHookCommandPlaceholders resolves quoted env references on posix', () => {
    expect(
      expandHookCommandPlaceholders(
        'node scripts/hook.js {{event}} {{conversationId}} {{toolName}}',
        'linux'
      )
    ).toBe(
      'node scripts/hook.js "${DEEPCHAT_HOOK_EVENT}" "${DEEPCHAT_CONVERSATION_ID}" "${DEEPCHAT_TOOL_NAME}"'
    )
  })

  it('expandHookCommandPlaceholders resolves quoted env references on windows', () => {
    expect(
      expandHookCommandPlaceholders(
        'powershell -File scripts/hook.ps1 {{event}} {{isTest}}',
        'win32'
      )
    ).toBe('powershell -File scripts/hook.ps1 "%DEEPCHAT_HOOK_EVENT%" "%DEEPCHAT_HOOK_IS_TEST%"')
  })

  it('createDefaultHookCommand uses important events', () => {
    expect(createDefaultHookCommand(0)).toEqual(
      expect.objectContaining({
        name: 'Hook 1',
        enabled: false,
        command: '',
        events: DEFAULT_IMPORTANT_HOOK_EVENTS
      })
    )
  })

  it('normalizeHooksNotificationsConfig sanitizes hook entries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const normalized = normalizeHooksNotificationsConfig({
      hooks: [
        {
          id: 'hook-1',
          name: ' Build Hook ',
          enabled: true,
          command: 'echo ok',
          events: ['SessionStart', 'UnknownEvent', 'SessionStart']
        },
        {
          enabled: false,
          command: 123
        }
      ],
      extra: 'ignored'
    })

    expect(normalized.hooks).toHaveLength(2)
    expect(normalized.hooks[0]).toEqual({
      id: 'hook-1',
      name: 'Build Hook',
      enabled: true,
      command: 'echo ok',
      events: ['SessionStart']
    })
    expect(normalized.hooks[1]).toEqual(
      expect.objectContaining({
        name: 'Hook 2',
        enabled: false,
        command: '',
        events: []
      })
    )
    expect(normalized.hooks[1].id).toBeTruthy()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('extra'))
  })

  it('normalizeHooksNotificationsConfig resets legacy config to defaults', () => {
    const defaults = createDefaultHooksNotificationsConfig()
    const normalized = normalizeHooksNotificationsConfig({
      telegram: { enabled: true, botToken: 'token' },
      commands: { enabled: true }
    })

    expect(normalized).toEqual(defaults)
  })

  it('normalizeHooksNotificationsConfig falls back to defaults for invalid input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(normalizeHooksNotificationsConfig(null)).toEqual(createDefaultHooksNotificationsConfig())
    expect(warn).toHaveBeenCalledWith(
      '[HooksNotifications] Invalid config, using defaults:',
      expect.stringContaining('expected object')
    )
  })

  it('normalizeHooksNotificationsConfig only enables hooks for boolean true', () => {
    const normalized = normalizeHooksNotificationsConfig({
      hooks: [
        {
          enabled: 'false'
        },
        {
          enabled: 1
        },
        {
          enabled: true
        }
      ]
    })

    expect(normalized.hooks.map((hook) => hook.enabled)).toEqual([false, false, true])
  })

  it('normalizeHooksNotificationsConfig keeps valid hooks when one item is malformed', () => {
    const normalized = normalizeHooksNotificationsConfig({
      hooks: [
        {
          id: 'hook-1',
          name: 'First Hook',
          enabled: true,
          command: 'echo first',
          events: ['SessionStart']
        },
        'not-an-object',
        {
          name: 'Broken Hook',
          events: 'SessionStart'
        },
        {
          enabled: false,
          command: 'echo second'
        }
      ]
    })

    expect(normalized.hooks).toHaveLength(2)
    expect(normalized.hooks[0]).toEqual({
      id: 'hook-1',
      name: 'First Hook',
      enabled: true,
      command: 'echo first',
      events: ['SessionStart']
    })
    expect(normalized.hooks[1]).toEqual(
      expect.objectContaining({
        name: 'Hook 2',
        enabled: false,
        command: 'echo second',
        events: []
      })
    )
    expect(normalized.hooks[1].id).toBeTruthy()
  })
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const enabledHook = (id: string, events: HookEventName[]): HookCommandItem => ({
  id,
  name: id,
  enabled: true,
  command: `run-${id}`,
  events
})

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = { write: vi.fn(), end: vi.fn() }
  readonly kill = vi.fn()
}

const spawnedPayloads = (): HookEventPayload[] =>
  spawnMock.mock.results.map(
    (result) =>
      JSON.parse(
        (result.value as FakeChild).stdin.write.mock.calls[0][0] as string
      ) as HookEventPayload
  )

const createHarness = (hooks: HookCommandItem[] = []) => {
  let stored: HooksNotificationsSettings = { hooks }
  const getHooksNotificationsConfig = vi.fn(() => stored)
  const setHooksNotificationsConfig = vi.fn((next: HooksNotificationsSettings) => {
    stored = next
    return next
  })
  const getSession = vi.fn().mockResolvedValue(null)
  const service = new HookService(
    { getHooksNotificationsConfig, setHooksNotificationsConfig },
    { getSession }
  )
  return {
    service,
    getSession,
    getHooksNotificationsConfig,
    setHooksNotificationsConfig,
    writeExternally: (next: HooksNotificationsSettings) => {
      stored = next
    }
  }
}

const toolEvent = (sessionId: string, callId: string): HookEvent => ({
  event: 'PostToolUse',
  session: { sessionId, providerId: 'openai', modelId: 'gpt-5', projectDir: null },
  tool: { callId, name: 'read_file', params: '{"path":"a.txt"}', response: 'ok' }
})

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => {
    const child = new FakeChild()
    queueMicrotask(() => child.emit('close', 0))
    return child
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HookService subscription index', () => {
  it('does nothing but one index lookup when no hook subscribes', async () => {
    const { service, getSession, getHooksNotificationsConfig } = createHarness()

    expect(service.isObserved('PostToolUse')).toBe(false)
    for (let index = 0; index < 25; index += 1) {
      service.notify(toolEvent('session-1', `call-${index}`))
    }
    await flush()

    expect(getSession).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(getHooksNotificationsConfig).toHaveBeenCalledTimes(1)
  })

  it('ignores hooks that are disabled or have no command', async () => {
    const { service } = createHarness([
      { id: 'a', name: 'a', enabled: false, command: 'run-a', events: ['PostToolUse'] },
      { id: 'b', name: 'b', enabled: true, command: '   ', events: ['PostToolUse'] }
    ])

    expect(service.isObserved('PostToolUse')).toBe(false)
    service.notify(toolEvent('session-1', 'call-1'))
    await flush()

    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('applies a configuration write to the index without re-reading the store', async () => {
    const { service, getHooksNotificationsConfig, setHooksNotificationsConfig } = createHarness()

    expect(service.isObserved('PostToolUse')).toBe(false)
    service.updateConfig({ hooks: [enabledHook('a', ['PostToolUse'])] })

    expect(setHooksNotificationsConfig).toHaveBeenCalledTimes(1)
    expect(service.isObserved('PostToolUse')).toBe(true)
    expect(getHooksNotificationsConfig).toHaveBeenCalledTimes(1)

    service.notify(toolEvent('session-1', 'call-1'))
    await flush()
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('detaches the configuration snapshot from its own delivery state', () => {
    const stored: HooksNotificationsSettings = { hooks: [enabledHook('a', ['Stop'])] }
    const service = new HookService(
      {
        getHooksNotificationsConfig: () => stored,
        setHooksNotificationsConfig: (next) => next
      },
      { getSession: vi.fn().mockResolvedValue(null) }
    )

    const snapshot = service.getConfigSnapshot()
    snapshot.hooks.push(enabledHook('b', ['PreToolUse']))
    snapshot.hooks[0].events.push('PreToolUse')

    expect(service.isObserved('PreToolUse')).toBe(false)
    expect(Object.isFrozen(stored)).toBe(false)
    expect(Object.isFrozen(stored.hooks[0])).toBe(false)
  })

  it('never backfills an event to a hook enabled in the same tick', async () => {
    const { service } = createHarness([enabledHook('a', ['PostToolUse'])])

    service.notify(toolEvent('session-1', 'call-1'))
    service.updateConfig({
      hooks: [enabledHook('a', ['PostToolUse']), enabledHook('b', ['PostToolUse'])]
    })
    await flush()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][0]).toBe('run-a')
  })

  it('never backfills an event while enrichment is still pending', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['PostToolUse'])])
    let releaseSession: (value: null) => void = () => undefined
    getSession.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        releaseSession = resolve
      })
    )

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'session-1' },
      tool: { callId: 'call-1' }
    })
    await flush()
    service.updateConfig({
      hooks: [enabledHook('a', ['PostToolUse']), enabledHook('b', ['PostToolUse'])]
    })
    releaseSession(null)
    await flush()

    expect(spawnMock.mock.calls.map(([command]) => command)).toEqual(['run-a'])
  })

  it('drops a queued event for a hook disabled or edited before delivery', async () => {
    const { service, getSession } = createHarness([
      enabledHook('a', ['PostToolUse']),
      enabledHook('b', ['PostToolUse']),
      enabledHook('c', ['PostToolUse'])
    ])
    let releaseSession: (value: null) => void = () => undefined
    getSession.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        releaseSession = resolve
      })
    )

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'session-1' },
      tool: { callId: 'call-1' }
    })
    await flush()
    service.updateConfig({
      hooks: [
        { ...enabledHook('a', ['PostToolUse']), enabled: false },
        { ...enabledHook('b', ['PostToolUse']), command: 'run-b-edited' },
        enabledHook('c', ['PostToolUse'])
      ]
    })
    releaseSession(null)
    await flush()

    expect(spawnMock.mock.calls.map(([command]) => command)).toEqual(['run-c'])
  })

  it('picks up a store write that bypassed the service after a refresh', () => {
    const { service, writeExternally } = createHarness()

    expect(service.isObserved('Stop')).toBe(false)
    writeExternally({ hooks: [enabledHook('a', ['Stop'])] })
    expect(service.isObserved('Stop')).toBe(false)

    service.refreshSubscriptions()
    expect(service.isObserved('Stop')).toBe(true)
  })

  it('rebuilds the index when the service restarts around a maintenance window', async () => {
    const { service, writeExternally } = createHarness()

    await service.stop()
    expect(service.isObserved('Stop')).toBe(false)

    writeExternally({ hooks: [enabledHook('a', ['Stop'])] })
    service.start()

    expect(service.isObserved('Stop')).toBe(true)
  })
})

describe('HookService delivery ordering', () => {
  it('keeps one session in emission order even when enrichment is slow', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['PostToolUse'])])
    let releaseSession: (value: null) => void = () => undefined
    getSession.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        releaseSession = resolve
      })
    )

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'session-1' },
      tool: { callId: 'slow' }
    })
    service.notify(toolEvent('session-1', 'fast'))
    await flush()

    expect(spawnMock).not.toHaveBeenCalled()

    releaseSession(null)
    await flush()

    expect(spawnedPayloads().map((payload) => payload.tool?.callId)).toEqual(['slow', 'fast'])
  })

  it('does not let one session block another', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['PostToolUse'])])
    getSession.mockReturnValueOnce(new Promise<null>(() => undefined))

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'blocked' },
      tool: { callId: 'stuck' }
    })
    service.notify(toolEvent('other', 'free'))
    await flush()

    expect(spawnedPayloads().map((payload) => payload.tool?.callId)).toEqual(['free'])
  })

  it('keeps delivering after a hook command fails to spawn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const spawnError = new Error('spawn failed')
    const { service } = createHarness([
      enabledHook('broken', ['PostToolUse']),
      enabledHook('healthy', ['PostToolUse'])
    ])
    spawnMock.mockImplementationOnce(() => {
      throw spawnError
    })

    service.notify(toolEvent('session-1', 'first'))
    await flush()
    service.notify(toolEvent('session-1', 'second'))
    await flush()

    expect(spawnMock).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledWith('[HooksNotifications] Hook "broken" failed:', spawnError)
  })

  it('stops delivering queued events once the service is stopped', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['PostToolUse'])])
    let releaseSession: (value: null) => void = () => undefined
    getSession.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        releaseSession = resolve
      })
    )

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'session-1' },
      tool: { callId: 'queued' }
    })
    releaseSession(null)
    const stopped = service.stop()
    await stopped
    await flush()

    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('kills a hook command that outlives the command timeout', async () => {
    vi.useFakeTimers()
    try {
      const { service } = createHarness([enabledHook('a', ['SessionStart'])])
      const child = new FakeChild()
      spawnMock.mockImplementationOnce(() => child)

      const pending = service.testHookCommand('a')
      await vi.advanceTimersByTimeAsync(30_000)

      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      // Settles without any close event: a killed shell can keep its process tree alive.
      await expect(pending).resolves.toMatchObject({
        success: false,
        exitCode: undefined,
        error: 'Command timed out'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds captured command output while the command streams', async () => {
    const { service } = createHarness([enabledHook('a', ['SessionStart'])])
    const child = new FakeChild()
    spawnMock.mockImplementationOnce(() => child)

    const pending = service.testHookCommand('a')
    await flush()
    for (let index = 0; index < 64; index += 1) {
      child.stdout.emit('data', 'x'.repeat(4096))
    }
    child.emit('close', 0)

    const result = await pending
    expect(result.stdout).toHaveLength(2000)
    expect(result.stdout?.endsWith(' ...(truncated)')).toBe(true)
  })

  it('redacts diagnostics on every settlement path', async () => {
    const { service } = createHarness([enabledHook('a', ['SessionStart'])])
    const child = new FakeChild()
    spawnMock.mockImplementationOnce(() => child)

    const pending = service.testHookCommand('a')
    await flush()
    child.stderr.emit('data', 'Authorization: Bearer sk-secret-token\n')
    child.emit('error', new Error('spawn ENOENT'))

    const result = await pending
    expect(result.error).toBe('spawn ENOENT')
    expect(result.stderr).toBe('Authorization: ***REDACTED***\n')
  })

  it('kills running hook commands on stop', async () => {
    const { service } = createHarness([enabledHook('a', ['PostToolUse'])])
    const child = new FakeChild()
    spawnMock.mockImplementationOnce(() => child)

    service.notify(toolEvent('session-1', 'call-1'))
    await flush()
    await service.stop()

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

describe('HookService payload projection', () => {
  it('truncates tool previews before any clone runs', async () => {
    const { service } = createHarness([enabledHook('a', ['PostToolUse'])])
    const clone = vi.spyOn(globalThis, 'structuredClone')
    const huge = 'x'.repeat(2_000_000)

    service.notify({
      event: 'PostToolUse',
      session: { sessionId: 'session-1', providerId: 'openai', modelId: 'gpt-5', projectDir: null },
      tool: { callId: 'call-1', name: 'write_file', params: huge, response: huge }
    })
    await flush()

    const [payload] = spawnedPayloads()
    expect(payload.tool?.paramsPreview).toHaveLength(1200)
    expect(payload.tool?.responsePreview).toHaveLength(1200)
    expect(clone).not.toHaveBeenCalled()
  })

  it('clones only the permission record and detaches it from later mutation', async () => {
    const { service } = createHarness([enabledHook('a', ['PermissionRequest'])])
    const clone = vi.spyOn(globalThis, 'structuredClone')
    const permission = { permissionType: 'write', metadata: { path: 'before.txt' } }

    service.notify({
      event: 'PermissionRequest',
      session: { sessionId: 'session-1', providerId: 'openai', modelId: 'gpt-5', projectDir: null },
      tool: { callId: 'call-1', name: 'write_file' },
      permission
    })
    permission.metadata.path = 'after.txt'
    await flush()

    expect(clone).toHaveBeenCalledTimes(1)
    expect(spawnedPayloads()[0].permission).toEqual({
      permissionType: 'write',
      metadata: { path: 'before.txt' }
    })
  })

  it('emits the version 1 payload shape', async () => {
    const { service } = createHarness([enabledHook('a', ['SessionEnd'])])

    service.notify({
      event: 'SessionEnd',
      session: {
        sessionId: 'session-1',
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-5',
        projectDir: '/workspace',
        messageId: 'message-1'
      },
      usage: { totalTokens: 12 },
      error: { message: 'boom' }
    })
    await flush()

    const [payload] = spawnedPayloads()
    expect(payload.time).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect({ ...payload, time: undefined }).toEqual({
      payloadVersion: 1,
      event: 'SessionEnd',
      time: undefined,
      isTest: false,
      app: { version: expect.any(String), platform: process.platform },
      session: {
        conversationId: 'session-1',
        agentId: 'deepchat',
        workdir: '/workspace',
        providerId: 'openai',
        modelId: 'gpt-5'
      },
      user: { messageId: 'message-1', promptPreview: '' },
      tool: null,
      permission: null,
      stop: null,
      usage: { totalTokens: 12 },
      error: { message: 'boom' }
    })
  })

  it('exposes the same core metadata through the command environment', async () => {
    const { service } = createHarness([enabledHook('a', ['PreToolUse'])])

    service.notify({
      event: 'PreToolUse',
      session: {
        sessionId: 'session-1',
        agentId: 'deepchat',
        providerId: 'openai',
        modelId: 'gpt-5',
        projectDir: null,
        messageId: 'message-1'
      },
      tool: { callId: 'call-1', name: 'read_file' }
    })
    await flush()

    const [, , options] = spawnMock.mock.calls[0]
    expect(options.env).toEqual(
      expect.objectContaining({
        DEEPCHAT_HOOK_EVENT: 'PreToolUse',
        DEEPCHAT_HOOK_IS_TEST: 'false',
        DEEPCHAT_CONVERSATION_ID: 'session-1',
        DEEPCHAT_AGENT_ID: 'deepchat',
        DEEPCHAT_PROVIDER_ID: 'openai',
        DEEPCHAT_MODEL_ID: 'gpt-5',
        DEEPCHAT_MESSAGE_ID: 'message-1',
        DEEPCHAT_TOOL_NAME: 'read_file',
        DEEPCHAT_TOOL_CALL_ID: 'call-1',
        DEEPCHAT_WORKDIR: ''
      })
    )
  })

  it('treats an explicit null project directory as an answered fact', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['Stop'])])

    service.notify({
      event: 'Stop',
      session: { sessionId: 'session-1', providerId: 'openai', modelId: 'gpt-5', projectDir: null },
      stop: { reason: 'complete', userStop: false }
    })
    await flush()

    expect(getSession).not.toHaveBeenCalled()
    expect(spawnedPayloads()[0].session.workdir).toBeNull()
  })

  it('resolves unanswered session facts from the session store', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['Stop'])])
    getSession.mockResolvedValueOnce({
      providerId: 'acp',
      modelId: 'claude-code',
      projectDir: '/from-db'
    })

    service.notify({
      event: 'Stop',
      session: { sessionId: 'session-1' },
      stop: { reason: 'complete', userStop: false }
    })
    await flush()

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(spawnedPayloads()[0].session).toEqual({
      conversationId: 'session-1',
      agentId: 'claude-code',
      workdir: '/from-db',
      providerId: 'acp',
      modelId: 'claude-code'
    })
  })

  it('never reads a message to describe a prompt it was not given', async () => {
    const { service } = createHarness([enabledHook('a', ['SessionStart'])])

    service.notify({
      event: 'SessionStart',
      session: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-5',
        projectDir: null,
        messageId: 'assistant-1'
      }
    })
    await flush()

    expect(spawnedPayloads()[0].user).toEqual({
      messageId: 'assistant-1',
      promptPreview: ''
    })
  })
})

describe('HookService detachment', () => {
  it('detaches session facts mutated after the event was accepted', async () => {
    const { service, getSession } = createHarness([enabledHook('a', ['Stop'])])
    let releaseSession: (value: null) => void = () => undefined
    getSession.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        releaseSession = resolve
      })
    )
    const session = { sessionId: 'session-1', modelId: 'gpt-5' }

    service.notify({ event: 'Stop', session, stop: { reason: 'complete', userStop: false } })
    session.modelId = 'mutated'
    releaseSession(null)
    await flush()

    expect(spawnedPayloads()[0].session.modelId).toBe('gpt-5')
  })
})
