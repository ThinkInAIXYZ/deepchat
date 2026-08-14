import { describe, expect, it, vi } from 'vitest'

import {
  PluginRuntimeSupervisor,
  type PluginRuntimeFingerprint,
  type PluginRuntimeProcessPort,
  type PluginRuntimeSafetyStore
} from '@/plugin/runtimeSupervisor'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createProcessPort() {
  const running = new Set<string>()
  const active = new Set<string>()
  const port: PluginRuntimeProcessPort = {
    isReady: vi.fn(() => true),
    isRunning: vi.fn((serverName) => running.has(serverName)),
    isActive: vi.fn((serverName) => active.has(serverName)),
    start: vi.fn(async (serverName) => {
      active.add(serverName)
      running.add(serverName)
    }),
    stop: vi.fn(async (serverName) => {
      running.delete(serverName)
      active.delete(serverName)
    })
  }
  return { port, running, active }
}

function createSafetyStore() {
  const values = new Map<string, unknown>()
  const store: PluginRuntimeSafetyStore = {
    read: vi.fn((key) => values.get(key)),
    write: vi.fn((key, sentinel) => values.set(key, sentinel)),
    remove: vi.fn((key) => values.delete(key))
  }
  return { store, values }
}

function runtimeFingerprint(seed: string): PluginRuntimeFingerprint {
  return {
    value: seed.repeat(64),
    pluginId: 'com.deepchat.plugins.fixture',
    runtimeId: 'fixture-runtime',
    target: 'linux/x64',
    binarySha256: seed.repeat(64)
  }
}

function register(
  supervisor: PluginRuntimeSupervisor,
  serverName: string,
  startMode: 'eager' | 'onDemand' = 'eager',
  adapter?: { start: () => Promise<void>; stop: () => Promise<void> },
  launchGuard?: { verify: () => Promise<PluginRuntimeFingerprint> }
) {
  supervisor.registerServer({
    pluginId: 'com.deepchat.plugins.fixture',
    serverName,
    runtimeId: 'fixture-runtime',
    startMode,
    surfaces: startMode === 'onDemand' ? ['tools'] : ['tools', 'prompts', 'resources'],
    toolCatalogPath: startMode === 'onDemand' ? '/fixture/tools.json' : undefined,
    toolCatalog:
      startMode === 'onDemand'
        ? {
            version: '1.0.0',
            tools: [
              {
                name: 'fixture_tool',
                description: 'Fixture tool',
                inputSchema: { type: 'object', properties: {} }
              }
            ]
          }
        : undefined,
    adapter,
    launchGuard
  })
}

describe('PluginRuntimeSupervisor', () => {
  it('coalesces concurrent starts and applies one adapter launch', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running } = createProcessPort()
    const launch = deferred<void>()
    const adapter = {
      start: vi.fn(() => launch.promise),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', adapter)

    const first = supervisor.ensureRunning('fixture', 'tool')
    const second = supervisor.ensureRunning('fixture', 'tool')
    launch.resolve()
    await Promise.all([first, second])

    expect(adapter.start).toHaveBeenCalledTimes(1)
    expect(port.start).toHaveBeenCalledTimes(1)
    expect(running.has('fixture')).toBe(true)
    expect(supervisor.getState('fixture')).toEqual({ state: 'running', lastError: undefined })
  })

  it('verifies both adapter and proxy spawns against one immutable fingerprint', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    const fingerprint = {
      value: 'a'.repeat(64),
      pluginId: 'com.deepchat.plugins.fixture',
      runtimeId: 'fixture-runtime',
      target: 'linux/x64',
      binarySha256: 'a'.repeat(64)
    }
    const launchGuard = {
      verify: vi.fn().mockResolvedValue(fingerprint)
    }
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', adapter, launchGuard)

    await supervisor.ensureRunning('fixture', 'tool')

    expect(launchGuard.verify).toHaveBeenCalledTimes(2)
    expect(adapter.start).toHaveBeenCalledTimes(1)
    expect(port.start).toHaveBeenCalledTimes(1)
    expect(launchGuard.verify.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.start.mock.invocationCallOrder[0]
    )
    expect(launchGuard.verify.mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(port.start).mock.invocationCallOrder[0]
    )
  })

  it('runs one integrity check for a server with only one process spawn', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    const launchGuard = {
      verify: vi.fn().mockResolvedValue({
        value: 'a'.repeat(64),
        pluginId: 'com.deepchat.plugins.fixture',
        runtimeId: 'fixture-runtime',
        target: 'linux/x64',
        binarySha256: 'a'.repeat(64)
      })
    }
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, launchGuard)

    await supervisor.ensureRunning('fixture', 'tool')

    expect(launchGuard.verify).toHaveBeenCalledOnce()
    expect(port.start).toHaveBeenCalledOnce()
  })

  it('marks a malformed launch fingerprint as an integrity block', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue({
        ...runtimeFingerprint('a'),
        pluginId: 'com.deepchat.plugins.other'
      })
    })

    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'does not match registration'
    )

    expect(port.start).not.toHaveBeenCalled()
    expect(supervisor.getState('fixture')).toMatchObject({
      state: 'error',
      integrityError: expect.stringContaining('does not match registration')
    })
  })

  it('stops the adapter when launch artifacts change before the proxy spawn', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    const launchGuard = {
      verify: vi
        .fn()
        .mockResolvedValueOnce({
          value: 'a'.repeat(64),
          pluginId: 'com.deepchat.plugins.fixture',
          runtimeId: 'fixture-runtime',
          target: 'linux/x64',
          binarySha256: 'a'.repeat(64)
        })
        .mockResolvedValueOnce({
          value: 'c'.repeat(64),
          pluginId: 'com.deepchat.plugins.fixture',
          runtimeId: 'fixture-runtime',
          target: 'linux/x64',
          binarySha256: 'b'.repeat(64)
        })
    }
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', adapter, launchGuard)

    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'changed between launch checks'
    )

    expect(port.start).not.toHaveBeenCalled()
    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(supervisor.getState('fixture')).toMatchObject({
      state: 'error',
      integrityError: expect.stringContaining('changed between launch checks')
    })
  })

  it('persists a sentinel before spawn and clears it only after a clean stop', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const { store, values } = createSafetyStore()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      expect(values.size).toBe(1)
      active.add(serverName)
      running.add(serverName)
    })
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await supervisor.ensureRunning('fixture', 'tool')

    expect(values.size).toBe(1)
    await supervisor.requestExternalStop('fixture')
    expect(values.size).toBe(0)
  })

  it('persists adapter launch context before the guarded daemon spawn', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store, values } = createSafetyStore()
    const adapter = {
      start: vi.fn().mockImplementation(async (_reason, safetyHooks) => {
        safetyHooks?.updateLaunchContext({
          endpoint: '/tmp/deepchat-cua-123-aabbccddeeff.sock',
          endpointDevice: '10',
          endpointInode: '20'
        })
        expect([...values.values()][0]).toMatchObject({
          launchContext: {
            endpoint: '/tmp/deepchat-cua-123-aabbccddeeff.sock',
            endpointDevice: '10',
            endpointInode: '20'
          }
        })
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverStaleLaunch: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', adapter, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await supervisor.ensureRunning('fixture', 'tool')

    expect(adapter.start).toHaveBeenCalledOnce()
    expect(values.size).toBe(1)
  })

  it('does not clear newer safety evidence written for the same fingerprint', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store, values } = createSafetyStore()
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await supervisor.ensureRunning('fixture', 'tool')

    const [key, sentinel] = [...values.entries()][0] as [
      string,
      { attemptId: string; fingerprint: PluginRuntimeFingerprint }
    ]
    values.set(key, {
      ...sentinel,
      attemptId: '00000000-0000-4000-8000-000000000001'
    })

    await supervisor.requestExternalStop('fixture')

    expect(values.get(key)).toMatchObject({
      attemptId: '00000000-0000-4000-8000-000000000001'
    })
    expect(supervisor.getState('fixture')).toMatchObject({ state: 'quarantined' })
  })

  it('quarantines a stale fingerprint and allows one explicit retry without changing intent', async () => {
    const { store, values } = createSafetyStore()
    const firstSupervisor = new PluginRuntimeSupervisor()
    const firstPort = createProcessPort()
    firstSupervisor.attachSafetyStore(store)
    firstSupervisor.attachProcessPort(firstPort.port)
    register(firstSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await firstSupervisor.ensureRunning('fixture', 'tool')
    expect(values.size).toBe(1)

    const restartedSupervisor = new PluginRuntimeSupervisor()
    const restartedPort = createProcessPort()
    restartedSupervisor.attachSafetyStore(store)
    restartedSupervisor.attachProcessPort(restartedPort.port)
    register(restartedSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    expect(restartedSupervisor.getState('fixture')).toMatchObject({ state: 'quarantined' })
    await expect(restartedSupervisor.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'quarantined after an unclean exit'
    )
    expect(restartedPort.port.start).not.toHaveBeenCalled()

    await restartedSupervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')
    expect(restartedPort.port.start).toHaveBeenCalledOnce()
    expect(restartedPort.port.stop).toHaveBeenCalledOnce()
    expect(restartedSupervisor.getState('fixture')).toMatchObject({ state: 'stopped' })
    expect(values.size).toBe(0)
  })

  it('recovers the exact stale adapter launch before an authorized retry', async () => {
    const { store } = createSafetyStore()
    const firstSupervisor = new PluginRuntimeSupervisor()
    const firstPort = createProcessPort()
    const firstAdapter = {
      start: vi.fn().mockImplementation(async (_reason, safetyHooks) => {
        safetyHooks?.updateLaunchContext({
          endpoint: '/tmp/deepchat-cua-123-aabbccddeeff.sock',
          endpointDevice: '10',
          endpointInode: '20'
        })
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverStaleLaunch: vi.fn().mockResolvedValue(undefined)
    }
    firstSupervisor.attachSafetyStore(store)
    firstSupervisor.attachProcessPort(firstPort.port)
    register(firstSupervisor, 'fixture', 'onDemand', firstAdapter, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await firstSupervisor.ensureRunning('fixture', 'tool')

    const restartedSupervisor = new PluginRuntimeSupervisor()
    const restartedPort = createProcessPort()
    const restartedAdapter = {
      start: vi.fn().mockImplementation(async (_reason, safetyHooks) => {
        safetyHooks?.updateLaunchContext({
          endpoint: '/tmp/deepchat-cua-456-001122334455.sock'
        })
      }),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverStaleLaunch: vi.fn().mockResolvedValue(undefined)
    }
    restartedSupervisor.attachSafetyStore(store)
    restartedSupervisor.attachProcessPort(restartedPort.port)
    register(restartedSupervisor, 'fixture', 'onDemand', restartedAdapter, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await restartedSupervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')

    expect(restartedAdapter.recoverStaleLaunch).toHaveBeenCalledWith({
      endpoint: '/tmp/deepchat-cua-123-aabbccddeeff.sock',
      endpointDevice: '10',
      endpointInode: '20'
    })
    expect(restartedAdapter.recoverStaleLaunch.mock.invocationCallOrder[0]).toBeLessThan(
      restartedAdapter.start.mock.invocationCallOrder[0]
    )
  })

  it('stops a locally owned daemon before retrying after its proxy exits', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const { store } = createSafetyStore()
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverStaleLaunch: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', adapter, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await supervisor.ensureRunning('fixture', 'tool')
    running.delete('fixture')
    active.delete('fixture')

    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'quarantined after an unclean exit'
    )
    await supervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')

    expect(adapter.start).toHaveBeenCalledTimes(2)
    expect(adapter.stop).toHaveBeenCalledTimes(2)
    expect(adapter.recoverStaleLaunch).not.toHaveBeenCalled()
    expect(adapter.stop.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.start.mock.invocationCallOrder[1]
    )
  })

  it('tests an idle on-demand runtime without leaving its process running', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    await supervisor.testRuntime('com.deepchat.plugins.fixture', 'fixture')

    expect(port.start).toHaveBeenCalledOnce()
    expect(port.stop).toHaveBeenCalledOnce()
    expect(supervisor.getState('fixture')).toEqual({
      state: 'stopped',
      lastError: undefined
    })
  })

  it('does not stop an on-demand runtime that was already running before a test', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    running.add('fixture')
    active.add('fixture')
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    await supervisor.testRuntime('com.deepchat.plugins.fixture', 'fixture')

    expect(port.start).not.toHaveBeenCalled()
    expect(port.stop).not.toHaveBeenCalled()
    expect(supervisor.getState('fixture')).toMatchObject({ state: 'running' })
  })

  it('holds tool starts behind an exclusive runtime probe', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const probeStop = deferred<void>()
    vi.mocked(port.stop).mockImplementationOnce(async (serverName) => {
      await probeStop.promise
      running.delete(serverName)
      active.delete(serverName)
    })
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    const probe = supervisor.testRuntime('com.deepchat.plugins.fixture', 'fixture')
    await vi.waitFor(() => expect(port.stop).toHaveBeenCalledOnce())
    const toolStart = supervisor.ensureRunning('fixture', 'tool')
    await Promise.resolve()

    expect(port.start).toHaveBeenCalledOnce()
    probeStop.resolve()
    await Promise.all([probe, toolStart])

    expect(port.start).toHaveBeenCalledTimes(2)
    expect(supervisor.getState('fixture')).toMatchObject({ state: 'running' })
  })

  it('propagates a failed runtime probe to tool callers waiting behind it', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, active } = createProcessPort()
    const probeStart = deferred<void>()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      active.add(serverName)
      await probeStart.promise
      throw new Error('probe failed')
    })
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    const probe = supervisor.testRuntime('com.deepchat.plugins.fixture', 'fixture')
    await vi.waitFor(() => expect(port.start).toHaveBeenCalledOnce())
    const toolStart = supervisor.ensureRunning('fixture', 'tool')
    probeStart.resolve()

    await expect(probe).rejects.toThrow('probe failed')
    await expect(toolStart).rejects.toThrow('probe failed')
    expect(port.start).toHaveBeenCalledOnce()
  })

  it('allows one automatic retry when the verified fingerprint changes', async () => {
    const { store } = createSafetyStore()
    const oldSupervisor = new PluginRuntimeSupervisor()
    oldSupervisor.attachSafetyStore(store)
    oldSupervisor.attachProcessPort(createProcessPort().port)
    register(oldSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await oldSupervisor.ensureRunning('fixture', 'tool')

    const upgradedSupervisor = new PluginRuntimeSupervisor()
    const upgradedPort = createProcessPort()
    upgradedSupervisor.attachSafetyStore(store)
    upgradedSupervisor.attachProcessPort(upgradedPort.port)
    register(upgradedSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('b'))
    })

    await expect(upgradedSupervisor.ensureRunning('fixture', 'tool')).resolves.toBeUndefined()
    expect(upgradedPort.port.start).toHaveBeenCalledOnce()

    const secondRestart = new PluginRuntimeSupervisor()
    const secondRestartPort = createProcessPort()
    secondRestart.attachSafetyStore(store)
    secondRestart.attachProcessPort(secondRestartPort.port)
    register(secondRestart, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('b'))
    })

    await expect(secondRestart.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'quarantined after an unclean exit'
    )
    expect(secondRestartPort.port.start).not.toHaveBeenCalled()
  })

  it('clears launch evidence after a failed spawn is cleanly contained', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, active } = createProcessPort()
    const { store, values } = createSafetyStore()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      active.add(serverName)
      throw new Error('spawn failed')
    })
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow('spawn failed')

    expect(port.stop).toHaveBeenCalledOnce()
    expect(values.size).toBe(0)
  })

  it('blocks spawn when persistent safety evidence cannot be written', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    vi.mocked(store.write).mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow('storage unavailable')
    expect(port.start).not.toHaveBeenCalled()
  })

  it('fails closed when persisted runtime safety evidence is malformed', () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { store, values } = createSafetyStore()
    values.set(JSON.stringify(['com.deepchat.plugins.fixture', 'fixture-runtime', 'fixture']), {
      schemaVersion: 1
    })
    supervisor.attachSafetyStore(store)

    expect(() =>
      register(supervisor, 'fixture', 'onDemand', undefined, {
        verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
      })
    ).toThrow('safety evidence is corrupt')
    expect(supervisor.ownsServer('fixture')).toBe(false)
  })

  it('fails closed when persisted launch context is malformed', async () => {
    const { store, values } = createSafetyStore()
    const firstSupervisor = new PluginRuntimeSupervisor()
    firstSupervisor.attachSafetyStore(store)
    firstSupervisor.attachProcessPort(createProcessPort().port)
    register(firstSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await firstSupervisor.ensureRunning('fixture', 'tool')
    const [key, sentinel] = [...values.entries()][0]
    values.set(key, {
      ...(sentinel as object),
      launchContext: { endpoint: 42 }
    })

    const restartedSupervisor = new PluginRuntimeSupervisor()
    restartedSupervisor.attachSafetyStore(store)

    expect(() =>
      register(restartedSupervisor, 'fixture', 'onDemand', undefined, {
        verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
      })
    ).toThrow('invalid launch context')
    expect(restartedSupervisor.ownsServer('fixture')).toBe(false)
  })

  it('does not grant retry authorization to a runtime that is not quarantined', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store } = createSafetyStore()
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })

    await expect(
      supervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')
    ).rejects.toThrow('is not quarantined')
    expect(port.start).not.toHaveBeenCalled()
  })

  it('keeps integrity failure distinct from quarantine until artifacts are repaired', async () => {
    const { store } = createSafetyStore()
    const firstSupervisor = new PluginRuntimeSupervisor()
    firstSupervisor.attachSafetyStore(store)
    firstSupervisor.attachProcessPort(createProcessPort().port)
    register(firstSupervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await firstSupervisor.ensureRunning('fixture', 'tool')

    const restartedSupervisor = new PluginRuntimeSupervisor()
    const restartedPort = createProcessPort()
    const verify = vi.fn().mockRejectedValue(new Error('runtime integrity mismatch'))
    restartedSupervisor.attachSafetyStore(store)
    restartedSupervisor.attachProcessPort(restartedPort.port)
    register(restartedSupervisor, 'fixture', 'onDemand', undefined, { verify })

    await expect(restartedSupervisor.ensureRunning('fixture', 'tool')).rejects.toThrow(
      'runtime integrity mismatch'
    )
    expect(restartedSupervisor.getState('fixture')).toMatchObject({
      state: 'quarantined',
      integrityError: expect.stringContaining('runtime integrity mismatch')
    })
    await expect(
      restartedSupervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')
    ).rejects.toThrow('cannot be retried')
    expect(restartedPort.port.start).not.toHaveBeenCalled()

    verify.mockResolvedValue(runtimeFingerprint('a'))
    await expect(
      restartedSupervisor.testRuntime('com.deepchat.plugins.fixture', 'fixture')
    ).rejects.toThrow('quarantined after an unclean exit')
    const repairedState = restartedSupervisor.getState('fixture')
    expect(repairedState).toMatchObject({ state: 'quarantined' })
    expect(repairedState).not.toHaveProperty('integrityError')

    await restartedSupervisor.retryRuntime('com.deepchat.plugins.fixture', 'fixture')
    expect(restartedPort.port.start).toHaveBeenCalledOnce()
    expect(restartedPort.port.stop).toHaveBeenCalledOnce()
  })

  it('blocks plugin-scoped runtime actions from crossing ownership boundaries', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    await expect(supervisor.testRuntime('com.deepchat.plugins.other', 'fixture')).rejects.toThrow(
      'does not own runtime server'
    )
    expect(port.start).not.toHaveBeenCalled()
  })

  it('quarantines a guarded runtime immediately when clean stop cannot be verified', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    const { store, values } = createSafetyStore()
    supervisor.attachSafetyStore(store)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand', undefined, {
      verify: vi.fn().mockResolvedValue(runtimeFingerprint('a'))
    })
    await supervisor.ensureRunning('fixture', 'tool')
    vi.mocked(port.stop).mockRejectedValueOnce(new Error('stop failed'))

    await expect(supervisor.requestExternalStop('fixture')).rejects.toThrow(
      'failed to stop cleanly'
    )

    expect(values.size).toBe(1)
    expect(supervisor.getState('fixture')).toMatchObject({
      state: 'quarantined',
      quarantine: {
        fingerprint: runtimeFingerprint('a')
      }
    })
  })

  it('rejects generic starts for on-demand servers without touching the process', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'onDemand')

    await expect(supervisor.requestExternalStart('fixture')).rejects.toThrow(
      'use a plugin runtime test or invoke one of its tools'
    )
    expect(port.start).not.toHaveBeenCalled()
  })

  it('exposes only committed on-demand catalogs and rejects missing discovery contracts', () => {
    const supervisor = new PluginRuntimeSupervisor()

    expect(() =>
      supervisor.registerServer({
        pluginId: 'com.deepchat.plugins.fixture',
        serverName: 'missing-catalog',
        startMode: 'onDemand',
        surfaces: ['tools']
      })
    ).toThrow('requires a tools-only static catalog')

    supervisor.registerServer(
      {
        pluginId: 'com.deepchat.plugins.fixture',
        serverName: 'catalog-server',
        displayName: 'Catalog Server',
        startMode: 'onDemand',
        surfaces: ['tools'],
        toolCatalogPath: '/fixture/tools.json',
        toolCatalog: {
          version: '1.0.0',
          tools: [
            {
              name: 'fixture_tool',
              description: 'Fixture tool',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        }
      },
      { ready: false }
    )

    expect(supervisor.getAvailableToolCatalogs()).toEqual([])
    expect(supervisor.getAvailableToolServerNames()).toEqual([])
    supervisor.commitPluginRegistration('com.deepchat.plugins.fixture')
    expect(supervisor.getAvailableToolCatalogs()).toEqual([
      expect.objectContaining({
        serverName: 'catalog-server',
        displayName: 'Catalog Server'
      })
    ])
    expect(supervisor.getAvailableToolServerNames()).toEqual(['catalog-server'])
  })

  it('gates staged registrations without exposing them before commit', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    supervisor.registerServer(
      {
        pluginId: 'com.deepchat.plugins.fixture',
        serverName: 'fixture',
        startMode: 'eager',
        surfaces: ['tools']
      },
      { ready: false }
    )

    expect(supervisor.ownsServer('fixture')).toBe(true)
    expect(supervisor.isServerAvailable('fixture')).toBe(false)
    expect(supervisor.getRegistration('fixture')).toBeUndefined()
    await expect(supervisor.ensureRunning('fixture', 'reconcile')).rejects.toThrow(
      'registration is not ready'
    )

    supervisor.commitPluginRegistration('com.deepchat.plugins.fixture')
    expect(supervisor.isServerAvailable('fixture')).toBe(true)
    expect(supervisor.getRegistration('fixture')).toMatchObject({ serverName: 'fixture' })
    await expect(supervisor.ensureRunning('fixture', 'reconcile')).resolves.toBeUndefined()
  })

  it('reconciles eager servers but leaves on-demand servers stopped', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'eager-server', 'eager')
    register(supervisor, 'lazy-server', 'onDemand')

    await supervisor.reconcileAll()

    expect(port.start).toHaveBeenCalledTimes(1)
    expect(port.start).toHaveBeenCalledWith('eager-server', undefined)
  })

  it('reconciles independent eager servers concurrently', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const firstStart = deferred<void>()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      active.add(serverName)
      if (serverName === 'first') {
        await firstStart.promise
      }
      running.add(serverName)
    })
    supervisor.attachProcessPort(port)
    register(supervisor, 'first')
    register(supervisor, 'second')

    const reconcile = supervisor.reconcileAll()
    await vi.waitFor(() => expect(port.start).toHaveBeenCalledTimes(2))
    firstStart.resolve()
    await reconcile

    expect(running).toEqual(new Set(['first', 'second']))
  })

  it('retries an inactive eager server after authentication completes', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'eager-server')
    register(supervisor, 'lazy-server', 'onDemand')

    await expect(supervisor.restartIfRunning('eager-server', 'authentication')).resolves.toBe(true)
    await expect(supervisor.restartIfRunning('lazy-server', 'authentication')).resolves.toBe(true)

    expect(port.start).toHaveBeenCalledTimes(1)
    expect(port.start).toHaveBeenCalledWith('eager-server', undefined)
  })

  it('waits for an in-flight start before performing a symmetric stop', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const processStart = deferred<void>()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      active.add(serverName)
      await processStart.promise
      running.add(serverName)
    })
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'eager', adapter)

    const start = supervisor.ensureRunning('fixture', 'reconcile')
    const stop = supervisor.requestExternalStop('fixture')
    expect(port.stop).not.toHaveBeenCalled()

    processStart.resolve()
    await Promise.all([start, stop])

    expect(port.stop).toHaveBeenCalledTimes(1)
    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(supervisor.getState('fixture')).toEqual({ state: 'stopped', lastError: undefined })
  })

  it('cleans up both MCP and adapter state after a failed start', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, active } = createProcessPort()
    vi.mocked(port.start).mockImplementation(async (serverName) => {
      active.add(serverName)
      throw new Error('connect failed')
    })
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'eager', adapter)

    await expect(supervisor.ensureRunning('fixture', 'reconcile')).rejects.toThrow('connect failed')

    expect(port.stop).toHaveBeenCalledWith('fixture', 'normal')
    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(supervisor.getState('fixture')).toEqual({
      state: 'error',
      lastError: 'connect failed'
    })
  })

  it('rejects ownership collisions and removes registrations after plugin disable', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture')

    expect(() =>
      supervisor.registerServer({
        pluginId: 'com.deepchat.plugins.other',
        serverName: 'fixture',
        startMode: 'eager',
        surfaces: ['tools']
      })
    ).toThrow('already registered')

    await supervisor.unregisterPlugin('com.deepchat.plugins.fixture')

    expect(supervisor.ownsServer('fixture')).toBe(false)
    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow('is not registered')
  })

  it('keeps a retired ownership gate when disable cleanup fails', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture')
    await supervisor.ensureRunning('fixture', 'reconcile')
    vi.mocked(port.stop).mockRejectedValueOnce(new Error('stop failed'))

    await expect(supervisor.unregisterPlugin('com.deepchat.plugins.fixture')).rejects.toThrow(
      'Failed to stop plugin runtime servers'
    )

    expect(supervisor.ownsServer('fixture')).toBe(true)
    expect(supervisor.isServerAvailable('fixture')).toBe(false)
    expect(supervisor.getRegistration('fixture')).toBeUndefined()
    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow('is being disabled')
    expect(running.has('fixture')).toBe(true)
    expect(active.has('fixture')).toBe(true)

    await supervisor.unregisterPlugin('com.deepchat.plugins.fixture')
    expect(supervisor.ownsServer('fixture')).toBe(false)
  })

  it('waits for an active stop before deciding whether another start is needed', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const processStop = deferred<void>()
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture')
    await supervisor.ensureRunning('fixture', 'reconcile')
    vi.mocked(port.stop).mockImplementationOnce(async (serverName) => {
      await processStop.promise
      running.delete(serverName)
      active.delete(serverName)
    })

    const stop = supervisor.requestExternalStop('fixture')
    const restart = supervisor.ensureRunning('fixture', 'configuration')
    await Promise.resolve()
    expect(port.start).toHaveBeenCalledTimes(1)

    processStop.resolve()
    await Promise.all([stop, restart])

    expect(port.start).toHaveBeenCalledTimes(2)
    expect(supervisor.getState('fixture')).toEqual({ state: 'running', lastError: undefined })
  })

  it('fails closed when the process port returns without a running client', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port } = createProcessPort()
    vi.mocked(port.start).mockResolvedValue(undefined)
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture')

    await expect(supervisor.ensureRunning('fixture', 'reconcile')).rejects.toThrow(
      'did not reach running state'
    )
    expect(supervisor.getState('fixture')).toEqual({
      state: 'error',
      lastError: 'Plugin runtime server "fixture" did not reach running state'
    })
  })

  it('refuses to stack a new launch over an incomplete active transition', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, active } = createProcessPort()
    active.add('fixture')
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture')

    await expect(supervisor.ensureRunning('fixture', 'runtime-test')).rejects.toThrow(
      'active process from an incomplete transition'
    )
    expect(port.start).not.toHaveBeenCalled()
    expect(supervisor.getState('fixture')).toEqual({
      state: 'error',
      lastError:
        'Plugin runtime server "fixture" still has an active process from an incomplete transition'
    })
  })

  it('blocks new starts and escalates a hanging normal stop during shutdown', async () => {
    const supervisor = new PluginRuntimeSupervisor()
    const { port, running, active } = createProcessPort()
    const normalStop = deferred<void>()
    const adapter = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined)
    }
    supervisor.attachProcessPort(port)
    register(supervisor, 'fixture', 'eager', adapter)
    await supervisor.ensureRunning('fixture', 'reconcile')
    vi.mocked(port.stop).mockImplementation(async (serverName, mode) => {
      if (mode === 'normal') {
        await normalStop.promise
      }
      running.delete(serverName)
      active.delete(serverName)
    })

    const disable = supervisor.requestExternalStop('fixture')
    await vi.waitFor(() => expect(port.stop).toHaveBeenCalledWith('fixture', 'normal'))
    await supervisor.shutdown()

    expect(port.stop).toHaveBeenCalledWith('fixture', 'shutdown')
    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(supervisor.isServerAvailable('fixture')).toBe(false)
    await expect(supervisor.ensureRunning('fixture', 'tool')).rejects.toThrow('shutting down')

    normalStop.resolve()
    await disable
  })
})
