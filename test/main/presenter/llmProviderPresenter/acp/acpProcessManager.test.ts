import { EventEmitter } from 'events'
import * as fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import spawn from 'cross-spawn'
import * as shellEnvHelper from '@/lib/agentRuntime/shellEnvHelper'
import {
  AcpProcessManager,
  parseLoadSessionCapability
} from '@/presenter/llmProviderPresenter/acp/acpProcessManager'

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

vi.mock('cross-spawn', () => ({
  default: vi.fn()
}))

vi.mock('@/lib/agentRuntime/shellEnvHelper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agentRuntime/shellEnvHelper')>()
  return {
    ...actual,
    getShellEnvironment: vi.fn().mockResolvedValue({ PATH: '/shell/bin' })
  }
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
      providerId: 'acp',
      resolveLaunchSpec: vi.fn().mockResolvedValue({
        agentId: 'agent-1',
        source: 'manual',
        distributionType: 'manual',
        command: 'agent',
        args: [],
        env: {}
      })
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

  it('keeps an explicit terminal cwd when the agent provides one', async () => {
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
      cwd: '/tmp/custom'
    })

    expect(createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        command: 'pwd',
        cwd: '/tmp/custom'
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

    try {
      const manager = new AcpProcessManager({
        providerId: 'acp',
        resolveLaunchSpec: vi.fn().mockResolvedValue({
          agentId: 'agent-1',
          source: 'manual',
          distributionType: 'npx',
          command: 'agent',
          args: [],
          env: {
            PATH: '/launch/bin',
            LAUNCH_ONLY: '1'
          },
          cwd: '/tmp/workspace'
        }),
        getAgentState: vi.fn().mockResolvedValue({
          envOverride: {
            PATH: '/user/bin',
            USER_ONLY: '1'
          }
        })
      })

      const child = new MockSpawnedChild()
      vi.mocked(spawn).mockReturnValue(child as never)
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
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)

      await (manager as any).spawnAgentProcess(
        {
          id: 'agent-1',
          name: 'Agent One',
          command: 'agent'
        },
        '/tmp/workspace'
      )

      expect(spawn).toHaveBeenCalled()
      const spawnArgs = vi.mocked(spawn).mock.calls[0]
      const spawnOptions = spawnArgs?.[2]
      const env = spawnOptions?.env as Record<string, string>
      const pathValue = normalizePathValue((env.PATH || env.Path || '').replace(/;/g, ':'))

      expect(spawnArgs?.[0]).toBe('agent')
      expect(spawnArgs?.[1]).toEqual([])
      expect(spawnOptions?.cwd).toBe('/tmp/workspace')
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
    }
  })
})
