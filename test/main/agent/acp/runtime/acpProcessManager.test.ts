import { EventEmitter } from 'events'
import * as fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import spawn from 'cross-spawn'
import * as shellEnvHelper from '@/agent/shared/process/shellEnvHelper'
import {
  AcpProcessManager,
  parseLoadSessionCapability
} from '@/agent/acp/runtime/acpProcessManager'
import { ToolchainService } from '@/toolchains'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('cross-spawn', () => ({
  default: vi.fn()
}))

vi.mock('@/agent/shared/process/shellEnvHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/agent/shared/process/shellEnvHelper')>()
  return {
    ...actual,
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' })
  }
})

beforeEach(() => {
  vi.spyOn(ToolchainService, 'getInstance').mockReturnValue({
    rewriteCommand: (command: string, args: string[]) => ({ command, args }),
    prependResolvedToEnv: (env: Record<string, string>) => ({
      ...env,
      PATH: ['/runtime/bin', env.PATH].filter(Boolean).join(':')
    })
  } as never)
})

class MockStream extends EventEmitter {}

class MockSpawnedChild extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  stdin = new MockStream()
  pid = 1234
  killed = false
  exitCode = null
  signalCode = null
  kill = vi.fn(() => true)
}

describe('parseLoadSessionCapability', () => {
  it('parses boolean capability from initialize result', () => {
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: true } })).toBe(true)
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: false } })).toBe(false)
  })

  it('returns undefined when capability is absent', () => {
    expect(parseLoadSessionCapability({})).toBeUndefined()
    expect(parseLoadSessionCapability(null)).toBeUndefined()
  })
})

describe('AcpProcessManager config cache fallback', () => {
  const normalizePathValue = (value: string) => value.replace(/\\/g, '/')

  const createManager = () =>
    new AcpProcessManager({
      publishEvent: publishDeepchatEventMock,
      providerId: 'acp',
      resolveLaunchSpec: vi.fn().mockResolvedValue({
        agentId: 'agent-1',
        source: 'manual',
        distributionType: 'manual',
        command: 'agent',
        args: [],
        env: {}
      }),
      terminalAuthAvailable: true
    })

  const createConfigState = (model = 'gpt-5', mode = 'code') => ({
    source: 'configOptions' as const,
    options: [
      {
        id: 'model',
        label: 'Model',
        type: 'select' as const,
        category: 'model',
        currentValue: model,
        options: [
          { value: 'gpt-5', label: 'gpt-5' },
          { value: 'gpt-5-mini', label: 'gpt-5-mini' }
        ]
      },
      {
        id: 'mode',
        label: 'Mode',
        type: 'select' as const,
        category: 'mode',
        currentValue: mode,
        options: [
          { value: 'code', label: 'code' },
          { value: 'ask', label: 'ask' }
        ]
      }
    ]
  })

  const createProcessHandle = (
    child: MockSpawnedChild,
    state: 'warmup' | 'bound' = 'warmup'
  ) => {
    Object.defineProperty(child, 'pid', { value: undefined })
    return {
      providerId: 'acp',
      agentId: 'agent-1',
      agent: { id: 'agent-1', name: 'Agent One', command: 'agent' },
      status: 'ready' as const,
      pid: undefined,
      restarts: 1,
      lastHeartbeatAt: Date.now(),
      metadata: {},
      child,
      connection: {},
      readyAt: Date.now(),
      state,
      boundConversationId: state === 'bound' ? 'conv-1' : undefined,
      workdir: '/tmp/workspace',
      configState: createConfigState(),
      materializedLaunch: {
        command: '/usr/local/bin/agent',
        args: ['--acp'],
        env: { PATH: '/runtime/bin', TOKEN: 'base' },
        cwd: '/tmp/workspace'
      },
      launchSignature: JSON.stringify({
        command: 'agent',
        args: [],
        env: {},
        cwd: null,
        distributionType: 'manual',
        version: null,
        installDir: null,
        userEnvOverride: {}
      })
    }
  }

  it('builds terminal authentication from the immutable launch snapshot', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      {
        id: 'browser-login',
        name: 'Browser login',
        type: 'terminal',
        args: ['auth', '--browser'],
        env: { TOKEN: 'method', AUTH_MODE: 'browser' }
      }
    ]

    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })
    const prepared = await manager.prepareTerminalAuthentication(challenge.id, 'browser-login')

    expect(prepared.launch).toEqual({
      command: '/usr/local/bin/agent',
      args: ['--acp', 'auth', '--browser'],
      env: { PATH: '/runtime/bin', TOKEN: 'method', AUTH_MODE: 'browser' },
      cwd: '/tmp/workspace'
    })

    handle.materializedLaunch.args.push('--mutated')
    handle.materializedLaunch.env.TOKEN = 'mutated'
    expect(prepared.launch.args).toEqual(['--acp', 'auth', '--browser'])
    expect(prepared.launch.env.TOKEN).toBe('method')
  })

  it('rejects terminal authentication after launch configuration changes', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })

    ;(manager as any).resolveLaunchSpec.mockResolvedValue({
      agentId: 'agent-1',
      source: 'manual',
      distributionType: 'manual',
      command: 'agent',
      args: ['--changed'],
      env: {}
    })

    await expect(
      manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    ).rejects.toThrow('challenge is stale')
  })

  it('serializes authentication runs for the same agent and workdir', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    const first = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })
    const second = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })

    await manager.prepareTerminalAuthentication(first.id, 'browser-login')
    await expect(
      manager.prepareTerminalAuthentication(second.id, 'browser-login')
    ).rejects.toThrow('already running for this agent and workdir')

    manager.abandonAuthentication(first.id)
    await expect(
      manager.prepareTerminalAuthentication(second.id, 'browser-login')
    ).resolves.toMatchObject({ challenge: { id: second.id } })
  })

  it('reserves a challenge before asynchronous launch validation', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })
    let resolveLaunch!: (value: {
      agentId: string
      source: 'manual'
      distributionType: 'manual'
      command: string
      args: string[]
      env: Record<string, string>
    }) => void
    ;(manager as any).resolveLaunchSpec.mockReturnValue(
      new Promise((resolve) => {
        resolveLaunch = resolve
      })
    )

    const firstStart = manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    await vi.waitFor(() => expect((manager as any).resolveLaunchSpec).toHaveBeenCalledOnce())
    await expect(
      manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    ).rejects.toThrow('already running')

    resolveLaunch({
      agentId: 'agent-1',
      source: 'manual',
      distributionType: 'manual',
      command: 'agent',
      args: [],
      env: {}
    })
    await expect(firstStart).resolves.toMatchObject({ challenge: { id: challenge.id } })
  })

  it('does not bind a warmup handle while authentication owns it', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    ;(manager as any).handles.set('agent-1::/tmp/workspace', handle)
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })

    await manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    manager.bindProcess('agent-1', 'conv-1')

    expect(handle.state).toBe('warmup')
    expect(manager.getBoundProcess('conv-1')).toBeNull()

    manager.abandonAuthentication(challenge.id)
    manager.bindProcess('agent-1', 'conv-1')
    expect(manager.getBoundProcess('conv-1')).toBe(handle)
  })

  it('consumes a terminal challenge before reconnecting', async () => {
    const manager = createManager()
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })
    await manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    vi.spyOn(manager, 'getConnection').mockRejectedValue(new Error('reconnect failed'))

    await expect(manager.completeTerminalAuthentication(challenge.id)).rejects.toThrow(
      'reconnect failed'
    )

    expect(() => manager.getAuthChallenge(challenge.id)).toThrow('unavailable or expired')
    expect((manager as any).activeAuthScopes.size).toBe(0)
  })

  it('bounds agent-owned authentication when the ACP request never settles', async () => {
    vi.useFakeTimers()
    const manager = createManager()
    const child = new MockSpawnedChild()
    const handle = createProcessHandle(child)
    handle.authMethods = [{ id: 'oauth', name: 'OAuth' }]
    handle.connection = {
      authenticate: vi.fn(() => new Promise(() => {})),
      closed: new Promise(() => {})
    } as any
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })
    try {
      const authentication = manager.authenticateAgent(challenge.id, 'oauth')
      const rejection = expect(authentication).rejects.toThrow('timed out')

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await rejection

      expect(child.kill).toHaveBeenCalledOnce()
      expect((manager as any).activeAuthScopes.size).toBe(0)
      expect(() => manager.getAuthChallenge(challenge.id)).toThrow('unavailable or expired')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose terminal methods as supported when the capability is disabled', () => {
    const manager = new AcpProcessManager({
      publishEvent: publishDeepchatEventMock,
      providerId: 'acp',
      resolveLaunchSpec: vi.fn().mockResolvedValue({
        agentId: 'agent-1',
        source: 'manual',
        distributionType: 'manual',
        command: 'agent',
        args: [],
        env: {}
      }),
      terminalAuthAvailable: false
    })
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]

    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })

    expect(challenge.methods).toEqual([
      { id: 'browser-login', name: 'Browser login', type: 'unsupported' }
    ])
  })

  it('rejects terminal authentication when the capability is disabled', async () => {
    const manager = new AcpProcessManager({
      publishEvent: publishDeepchatEventMock,
      providerId: 'acp',
      resolveLaunchSpec: vi.fn(),
      terminalAuthAvailable: false
    })
    const handle = createProcessHandle(new MockSpawnedChild())
    handle.authMethods = [
      { id: 'browser-login', name: 'Browser login', type: 'terminal', args: ['auth'] }
    ]
    const challenge = manager.createAuthChallenge(handle as any, { origin: 'settings_probe' })

    await expect(
      manager.prepareTerminalAuthentication(challenge.id, 'browser-login')
    ).rejects.toThrow('Terminal ACP authentication is unavailable')
  })

  it('falls back to the latest agent config when no scoped handle matches', () => {
    const manager = createManager()
    const configState = createConfigState('gpt-5-mini', 'ask')

    ;(manager as any).latestConfigStates.set('agent-1', configState)
    ;(manager as any).latestModeSnapshots.set('agent-1', {
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })

    expect(manager.getProcessConfigState('agent-1', '/tmp/missing')).toEqual(configState)
    expect(manager.getProcessModes('agent-1', '/tmp/missing')).toEqual({
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })
  })

  it('does not return another agent cache entry when the requested agent has no snapshot', () => {
    const manager = createManager()
    const configState = createConfigState('gpt-5-mini', 'ask')

    ;(manager as any).latestConfigStates.set('agent-1', configState)
    ;(manager as any).latestModeSnapshots.set('agent-1', {
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })

    expect(manager.getProcessConfigState('agent-2', '/tmp/missing')).toBeUndefined()
    expect(manager.getProcessModes('agent-2', '/tmp/missing')).toBeUndefined()
  })

  it('falls back when a warmup workdir no longer exists', () => {
    const manager = createManager()
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    try {
      const resolved = (manager as any).resolveWorkdir('/tmp/missing-workspace')

      expect(normalizePathValue(resolved)).toContain('/tmp/deepchat-acp/sessions')
    } finally {
      existsSpy.mockRestore()
    }
  })

  it('buffers early session updates until a listener is registered', () => {
    const manager = createManager()
    const handler = vi.fn()
    const notification = {
      sessionId: 'session-early',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'plan', description: 'Plan work' }]
      }
    }

    ;(manager as any).dispatchSessionUpdate(notification)
    expect(handler).not.toHaveBeenCalled()

    manager.registerSessionListener('agent-1', 'session-early', handler)
    expect(handler).toHaveBeenCalledWith(notification)
  })

  it('drops expired buffered session updates before replaying them', () => {
    vi.useFakeTimers()

    try {
      const manager = createManager()
      const handler = vi.fn()
      const notification = {
        sessionId: 'session-expired',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'plan', description: 'Plan work' }]
        }
      }

      vi.setSystemTime(0)
      ;(manager as any).dispatchSessionUpdate(notification)
      vi.setSystemTime(31_000)
      manager.registerSessionListener('agent-1', 'session-expired', handler)

      expect(handler).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes the agent cache when bound session config changes', () => {
    const manager = createManager()
    const handle = {
      agentId: 'agent-1',
      workdir: '/tmp/workspace',
      state: 'bound',
      configState: createConfigState('gpt-5', 'code'),
      availableModes: [{ id: 'code', name: 'Code', description: '' }],
      currentModeId: 'code',
      child: { killed: false, exitCode: null, signalCode: null },
      connection: {},
      readyAt: Date.now(),
      providerId: 'acp',
      status: 'ready'
    }

    ;(manager as any).boundHandles.set('conv-1', handle)

    const nextConfigState = createConfigState('gpt-5-mini', 'ask')

    expect(manager.updateBoundProcessConfigState('conv-1', nextConfigState as any)).toBe(true)
    expect(manager.getProcessConfigState('agent-1', '/tmp/other')).toEqual(nextConfigState)
    expect(manager.getProcessModes('agent-1', '/tmp/other')).toEqual({
      availableModes: [
        { id: 'code', name: 'code', description: '' },
        { id: 'ask', name: 'ask', description: '' }
      ],
      currentModeId: 'ask'
    })
  })

  it('publishes typed ready events for cached process modes and config options', () => {
    const manager = createManager()
    const configState = createConfigState('gpt-5-mini', 'ask')
    const handle = {
      agentId: 'agent-1',
      workdir: '/tmp/workspace',
      state: 'bound',
      configState,
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask',
      child: { killed: false, exitCode: null, signalCode: null },
      connection: {},
      readyAt: Date.now(),
      providerId: 'acp',
      status: 'ready'
    }

    ;(manager as any).notifyModesReady(handle, 'conv-1')
    ;(manager as any).notifyConfigOptionsReady(handle, 'conv-1')

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.modes.ready', {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      workdir: '/tmp/workspace',
      current: 'ask',
      available: [{ id: 'ask', name: 'Ask', description: '' }],
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.acp.configOptions.ready', {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      workdir: '/tmp/workspace',
      configState,
      version: expect.any(Number)
    })
  })

  it('uses the session workdir as terminal cwd when the agent does not provide one', async () => {
    const manager = createManager()
    const createTerminal = vi.fn().mockResolvedValue({ terminalId: 'term-1' })

    ;(manager as any).terminalManager = {
      createTerminal,
      terminalOutput: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      releaseTerminal: vi.fn()
    }
    ;(manager as any).sessionWorkdirs.set('session-1', '/tmp/workspace')

    const client = (manager as any).createClientProxy()

    await client.createTerminal({
      sessionId: 'session-1',
      command: 'pwd'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'pwd',
        cwd: '/tmp/workspace'
      })
    )
  })

  it('keeps an explicit terminal cwd when it is inside the session workdir', async () => {
    const manager = createManager()
    const createTerminal = vi.fn().mockResolvedValue({ terminalId: 'term-1' })

    ;(manager as any).terminalManager = {
      createTerminal,
      terminalOutput: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      releaseTerminal: vi.fn()
    }
    ;(manager as any).sessionWorkdirs.set('session-1', '/tmp/workspace')

    const client = (manager as any).createClientProxy()

    await client.createTerminal({
      sessionId: 'session-1',
      command: 'pwd',
      cwd: '/tmp/workspace/subdir'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'pwd',
        cwd: '/tmp/workspace/subdir'
      })
    )
  })

  it('resolves a relative terminal cwd inside the session workdir', async () => {
    const manager = createManager()
    const createTerminal = vi.fn().mockResolvedValue({ terminalId: 'term-1' })

    ;(manager as any).terminalManager = {
      createTerminal,
      terminalOutput: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      releaseTerminal: vi.fn()
    }
    ;(manager as any).sessionWorkdirs.set('session-1', '/tmp/workspace')

    const client = (manager as any).createClientProxy()

    await client.createTerminal({
      sessionId: 'session-1',
      command: 'pwd',
      cwd: 'subdir'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'pwd',
        cwd: '/tmp/workspace/subdir'
      })
    )
  })

  it('falls back to the session workdir when explicit terminal cwd escapes it', async () => {
    const manager = createManager()
    const createTerminal = vi.fn().mockResolvedValue({ terminalId: 'term-1' })

    ;(manager as any).terminalManager = {
      createTerminal,
      terminalOutput: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      releaseTerminal: vi.fn()
    }
    ;(manager as any).sessionWorkdirs.set('session-1', '/tmp/workspace')

    const client = (manager as any).createClientProxy()

    await client.createTerminal({
      sessionId: 'session-1',
      command: 'pwd',
      cwd: '/tmp/other'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'pwd',
        cwd: '/tmp/workspace'
      })
    )
  })

  it('falls back to the ACP temp workdir instead of process.cwd() when session workdir is missing', async () => {
    const manager = createManager()
    const createTerminal = vi.fn().mockResolvedValue({ terminalId: 'term-1' })

    ;(manager as any).terminalManager = {
      createTerminal,
      terminalOutput: vi.fn(),
      waitForTerminalExit: vi.fn(),
      killTerminal: vi.fn(),
      releaseTerminal: vi.fn()
    }

    const client = (manager as any).createClientProxy()

    await client.createTerminal({
      sessionId: 'missing-session',
      command: 'pwd'
    })

    const terminalRequest = createTerminal.mock.calls[0]?.[0]
    expect(terminalRequest.sessionId).toBe('missing-session')
    expect(terminalRequest.command).toBe('pwd')
    expect(normalizePathValue(terminalRequest.cwd)).toContain('/deepchat-acp/sessions')
  })

  it('keeps explicit PATH overrides ahead of bundled runtime and shell PATH', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = '/usr/bin:/bin'
    let existsSpy: { mockRestore: () => void } | null = null
    let statSpy: { mockRestore: () => void } | null = null

    try {
      const launchSpec = {
        agentId: 'agent-1',
        source: 'manual',
        distributionType: 'npx' as const,
        command: 'agent',
        args: [],
        env: {
          PATH: '/launch/bin',
          LAUNCH_ONLY: '1'
        },
        cwd: '/tmp/workspace'
      }
      const manager = new AcpProcessManager({
        publishEvent: publishDeepchatEventMock,
        providerId: 'acp',
        resolveLaunchSpec: vi.fn().mockResolvedValue(launchSpec),
        getAgentState: vi.fn().mockResolvedValue({
          envOverride: {
            PATH: '/user/bin',
            USER_ONLY: '1'
          }
        })
      })

      vi.spyOn(shellEnvHelper, 'getShellEnvironment').mockResolvedValue({
        PATH: '/shell/bin'
      })
      vi.spyOn((manager as any).runtimeHelper, 'initializeRuntimes').mockImplementation(() => {})
      vi.spyOn((manager as any).runtimeHelper, 'expandPath').mockImplementation(
        (value: string) => value
      )
      vi.spyOn((manager as any).runtimeHelper, 'replaceWithRuntimeCommand').mockImplementation(
        (value: string) => value
      )
      vi.spyOn((manager as any).runtimeHelper, 'prependBundledRuntimeToEnv').mockImplementation(
        (env: Record<string, string>) => ({
          ...env,
          PATH: ['/runtime/bin', env.PATH].filter(Boolean).join(':')
        })
      )
      vi.spyOn((manager as any).runtimeHelper, 'getDefaultPaths').mockReturnValue(['/default/bin'])
      vi.spyOn((manager as any).runtimeHelper, 'getUvRuntimePath').mockReturnValue('/runtime/bin')
      vi.spyOn((manager as any).runtimeHelper, 'getNodeRuntimePath').mockReturnValue(null)
      vi.spyOn((manager as any).runtimeHelper, 'isInstalledInSystemDirectory').mockReturnValue(
        false
      )
      vi.spyOn((manager as any).runtimeHelper, 'getUserNpmPrefix').mockReturnValue(null)
      existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({
        isDirectory: () => true
      } as fs.Stats)

      const launch = await (manager as any).materializeAgentLaunch(
        {
          id: 'agent-1',
          name: 'Agent One',
          command: 'agent'
        },
        '/tmp/workspace',
        launchSpec,
        {
          envOverride: {
            PATH: '/user/bin',
            USER_ONLY: '1'
          }
        }
      )

      const env = launch.env as Record<string, string>
      const pathValue = normalizePathValue((env.PATH || env.Path || '').replace(/;/g, ':'))

      expect(launch.command).toBe('agent')
      expect(launch.args).toEqual([])
      expect(launch.cwd).toBe('/tmp/workspace')
      expect(env.LAUNCH_ONLY).toBe('1')
      expect(env.USER_ONLY).toBe('1')
      expect(env.ACP_IDE).toBe('deepchat')
      expect(env.DEEPCHAT_ACP_AGENT_ID).toBe('agent-1')
      expect(pathValue).toContain('/user/bin')
      expect(pathValue).toContain('/launch/bin')
      expect(pathValue).toContain('/runtime/bin')
      expect(pathValue).toContain('/shell/bin')
      expect(pathValue.indexOf('/user/bin')).toBeLessThan(pathValue.indexOf('/launch/bin'))
      expect(pathValue.indexOf('/launch/bin')).toBeLessThan(pathValue.indexOf('/runtime/bin'))
    } finally {
      process.env.PATH = originalPath
      existsSpy?.mockRestore()
      statSpy?.mockRestore()
    }
  })

  it('throws for a missing explicit workdir instead of falling back to home', async () => {
    const manager = createManager()
    const launchSpec = {
      agentId: 'agent-1',
      source: 'manual',
      distributionType: 'manual' as const,
      command: 'agent',
      args: [],
      env: {}
    }
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.mocked(spawn).mockClear()
    vi.spyOn(shellEnvHelper, 'getShellEnvironment').mockResolvedValue({
      PATH: '/shell/bin'
    })
    vi.spyOn((manager as any).runtimeHelper, 'initializeRuntimes').mockImplementation(() => {})
    vi.spyOn((manager as any).runtimeHelper, 'expandPath').mockImplementation(
      (value: string) => value
    )
    vi.spyOn((manager as any).runtimeHelper, 'replaceWithRuntimeCommand').mockImplementation(
      (value: string) => value
    )

    try {
      await expect(
        (manager as any).materializeAgentLaunch(
          {
            id: 'agent-1',
            name: 'Agent One',
            command: 'agent'
          },
          '/tmp/missing-workspace',
          launchSpec,
          undefined
        )
      ).rejects.toThrow('[ACP] workdir "/tmp/missing-workspace" does not exist for agent agent-1')
    } finally {
      existsSpy.mockRestore()
    }
  })

  it('moves only the broken npx hash directory and retries once', async () => {
    const npxRoot = normalizePathValue('/tmp/deepchat-acp-npx/_npx')
    const badHashDir = `${npxRoot}/286fc3b7ffd18687`
    const otherHashDir = `${npxRoot}/keep-me`
    const existingDirs = new Set([path.normalize(badHashDir), path.normalize(otherHashDir)])
    const renameImpl = vi.fn((from: string, to: string) => {
      existingDirs.delete(path.normalize(from))
      existingDirs.add(path.normalize(to))
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(renameImpl)
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((input) => existingDirs.has(path.normalize(String(input))))
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation((input) => {
      if (existingDirs.has(path.normalize(String(input)))) {
        return { isDirectory: () => true } as fs.Stats
      }
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    try {
      const manager = createManager()
      const launchSpec = {
        agentId: 'agent-1',
        source: 'manual',
        distributionType: 'npx' as const,
        command: 'npx',
        args: ['-y', 'agent'],
        env: {}
      }
      const firstError = new Error('initialization failed')
      ;(firstError as Error & { acpStderr?: string }).acpStderr = [
        'npm error code ENOENT',
        `npm error path ${badHashDir}/package.json`,
        'npm error enoent Could not read package.json'
      ].join('\n')
      const readyHandle = { agentId: 'agent-1', status: 'ready' }
      const spawnOnceSpy = vi
        .spyOn(manager as any, 'spawnProcessOnce')
        .mockRejectedValueOnce(firstError)
        .mockResolvedValueOnce(readyHandle)

      await expect(
        (manager as any).spawnProcess(
          {
            id: 'agent-1',
            name: 'Agent One',
            command: 'npx'
          },
          '/tmp/workspace',
          launchSpec,
          'signature'
        )
      ).resolves.toBe(readyHandle)

      expect(spawnOnceSpy).toHaveBeenCalledTimes(2)
      expect(renameImpl).toHaveBeenCalledWith(
        path.normalize(badHashDir),
        expect.stringMatching(/[\\/]286fc3b7ffd18687\.bad-\d+$/)
      )
      expect(existingDirs.has(path.normalize(badHashDir))).toBe(false)
      expect(existingDirs.has(path.normalize(otherHashDir))).toBe(true)
    } finally {
      renameSpy.mockRestore()
      existsSpy.mockRestore()
      statSpy.mockRestore()
    }
  })

  it('does not repair npx cache for non-npx or unrelated ENOENT failures', async () => {
    const tmpRoot = '/tmp/deepchat-acp-npx-skip'
    const npxRoot = `${tmpRoot}/_npx`
    const badHashDir = `${npxRoot}/286fc3b7ffd18687`
    const renameImpl = vi.fn()
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(renameImpl)

    try {
      const cases = [
        {
          distributionType: 'manual' as const,
          stderr: ['npm error code ENOENT', `npm error path ${badHashDir}/package.json`].join('\n')
        },
        {
          distributionType: 'npx' as const,
          stderr: `npm error path ${badHashDir}/package.json`
        },
        {
          distributionType: 'npx' as const,
          stderr: `npm error code ENOENT\nnpm error path ${tmpRoot}/package.json`
        }
      ]

      for (const testCase of cases) {
        const manager = createManager()
        const launchSpec = {
          agentId: 'agent-1',
          source: 'manual',
          distributionType: testCase.distributionType,
          command: 'npx',
          args: [],
          env: {}
        }
        const error = new Error('initialization failed')
        ;(error as Error & { acpStderr?: string }).acpStderr = testCase.stderr
        const spawnOnceSpy = vi.spyOn(manager as any, 'spawnProcessOnce').mockRejectedValue(error)

        await expect(
          (manager as any).spawnProcess(
            {
              id: 'agent-1',
              name: 'Agent One',
              command: 'npx'
            },
            '/tmp/workspace',
            launchSpec,
            'signature'
          )
        ).rejects.toBe(error)

        expect(spawnOnceSpy).toHaveBeenCalledTimes(1)
        expect(renameImpl).not.toHaveBeenCalled()
      }
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('does not create a temporary session during warmup', async () => {
    const manager = createManager()
    const newSession = vi.fn().mockResolvedValue({ sessionId: 'temp-session' })
    const handle = {
      providerId: 'acp',
      agentId: 'agent-1',
      agent: { id: 'agent-1', name: 'Agent One', command: 'agent' },
      status: 'ready',
      pid: 1234,
      restarts: 1,
      lastHeartbeatAt: Date.now(),
      metadata: {},
      child: { killed: false, exitCode: null, signalCode: null, on: vi.fn() },
      connection: { newSession },
      readyAt: Date.now(),
      state: 'warmup',
      workdir: '/tmp/workspace',
      launchSignature: JSON.stringify({
        command: 'agent',
        args: [],
        env: {},
        cwd: null,
        distributionType: 'manual',
        version: null,
        installDir: null
      })
    }

    vi.spyOn(manager as any, 'spawnProcess').mockResolvedValue(handle)

    await manager.warmupProcess(
      {
        id: 'agent-1',
        name: 'Agent One',
        command: 'agent'
      },
      '/tmp/workspace'
    )

    expect(newSession).not.toHaveBeenCalled()
  })

  it('rejects and disposes a warmup that resolves after shutdown', async () => {
    const manager = createManager()
    const child = new MockSpawnedChild()
    const handle = createProcessHandle(child)
    const terminalShutdown = vi.fn().mockResolvedValue(undefined)
    let resolveHandle: ((value: typeof handle) => void) | undefined
    const pendingHandle = new Promise<typeof handle>((resolve) => {
      resolveHandle = resolve
    })
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)

    ;(manager as any).terminalManager = { shutdown: terminalShutdown }
    const disposeHandle = vi.spyOn(manager as any, 'disposeHandle')
    vi.spyOn(manager as any, 'spawnProcess').mockReturnValue(pendingHandle)
    publishDeepchatEventMock.mockClear()
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const agent = { id: 'agent-1', name: 'Agent One', command: 'agent' }
      const warmupResult = manager.warmupProcess(agent, '/tmp/workspace').then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      )

      await vi.waitFor(() => expect((manager as any).pendingHandles.size).toBe(1))
      const shutdownResult = manager.shutdown()

      expect((manager as any).shuttingDown).toBe(true)
      expect((manager as any).handles.size).toBe(0)
      expect((manager as any).boundHandles.size).toBe(0)
      expect((manager as any).pendingHandles.size).toBe(0)
      expect((manager as any).sessionListeners.size).toBe(0)
      expect((manager as any).permissionResolvers.size).toBe(0)
      expect((manager as any).processExitHandlers.size).toBe(0)
      await expect(manager.warmupProcess(agent, '/tmp/workspace')).rejects.toThrow(
        'Process manager is shutting down'
      )
      await expect(manager.getConnection(agent, '/tmp/workspace')).rejects.toThrow(
        'Process manager is shutting down'
      )
      await shutdownResult
      expect(terminalShutdown).toHaveBeenCalledTimes(1)

      resolveHandle?.(handle)
      const result = await warmupResult
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect(result.error).toEqual(
          expect.objectContaining({ message: expect.stringContaining('shutting down') })
        )
      }
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(disposeHandle).toHaveBeenCalledTimes(1)
      expect(child.kill).toHaveBeenCalledTimes(1)
      expect((manager as any).handles.size).toBe(0)
      expect((manager as any).boundHandles.size).toBe(0)
      expect((manager as any).pendingHandles.size).toBe(0)
      expect((manager as any).initializingChildren.size).toBe(0)
      expect(publishDeepchatEventMock).not.toHaveBeenCalled()
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('disposes a stale expected handle without unbinding its replacement', async () => {
    const manager = createManager()
    const staleChild = new MockSpawnedChild()
    const replacementChild = new MockSpawnedChild()
    const staleHandle = createProcessHandle(staleChild, 'bound')
    const replacementHandle = createProcessHandle(replacementChild, 'bound')
    const nextConfigState = createConfigState('gpt-5-mini', 'ask')

    ;(manager as any).boundHandles.set('conv-1', replacementHandle)

    await manager.unbindProcess('agent-1', 'conv-1', staleHandle as any)
    await manager.unbindProcess('agent-1', 'conv-1', staleHandle as any)

    expect(staleChild.kill).toHaveBeenCalledTimes(1)
    expect(replacementChild.kill).not.toHaveBeenCalled()
    expect(manager.getBoundProcess('conv-1')).toBe(replacementHandle)
    expect(manager.updateBoundProcessConfigState('conv-1', nextConfigState)).toBe(true)
    expect(replacementHandle.configState).toBe(nextConfigState)

    await manager.unbindProcess('agent-1', 'conv-1', replacementHandle as any)

    expect(replacementChild.kill).toHaveBeenCalledTimes(1)
    expect(manager.getBoundProcess('conv-1')).toBeNull()
  })

  it('settles registered session exit handlers once when the process scope is cleared', () => {
    const manager = createManager()
    const onExit = vi.fn()
    manager.registerProcessExitHandler('agent-1', 'remote-session', onExit)

    ;(manager as any).clearSessionsForAgent('agent-1')
    ;(manager as any).clearSessionsForAgent('agent-1')

    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
