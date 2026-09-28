import { EventEmitter } from 'events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const sdkMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  initializeResponse: {
    protocolVersion: 1,
    agentInfo: { name: 'Agent One', version: '1.0.0' },
    agentCapabilities: {
      _meta: { lody: { usage: { version: 1 } } },
      loadSession: true,
      promptCapabilities: {
        image: true,
        audio: true,
        embeddedContext: true
      },
      sessionCapabilities: {
        list: {},
        resume: {},
        close: {},
        fork: {}
      },
      mcpCapabilities: {
        http: true
      }
    },
    authMethods: [{ id: 'terminal', name: 'Terminal', type: 'terminal' }]
  }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

const childProcessRegistryMock = vi.hoisted(() => ({
  record: vi.fn(),
  clear: vi.fn(),
  reapStaleOnce: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/agent/shared/process/childProcessRegistry', () => ({
  childProcessRegistry: childProcessRegistryMock
}))

class MockChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = 1234
  killed = false
  exitCode = null
  signalCode = null
  kill = vi.fn(() => true)
}

describe('AcpProcessManager initialized capabilities', () => {
  it.each([true, false])(
    'carries initialize capabilities into the ready process handle when terminal auth is %s',
    async (terminalAuthAvailable) => {
      sdkMock.initialize.mockClear()
      const { AcpProcessManager } = await import('@/agent/acp/runtime/acpProcessManager')
      const manager = new AcpProcessManager({
        publishEvent: vi.fn(),
        providerId: 'acp',
        resolveLaunchSpec: vi.fn(),
        terminalAuthAvailable
      })
      const child = new MockChild()
      child.stdin.on('data', (chunk) => {
        const request = JSON.parse(chunk.toString())
        sdkMock.initialize(request.params)
        child.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: sdkMock.initializeResponse })}\n`
        )
      })
      vi.spyOn(manager as any, 'materializeAgentLaunch').mockResolvedValue({
        command: 'agent',
        args: [],
        env: {},
        cwd: '/tmp/workspace'
      })
      vi.spyOn(manager as any, 'spawnAgentProcess').mockReturnValue(child)

      const handle = await (manager as any).spawnProcessOnce(
        {
          id: 'agent-1',
          name: 'Agent One',
          command: 'agent'
        },
        '/tmp/workspace',
        {
          agentId: 'agent-1',
          source: 'manual',
          distributionType: 'manual',
          command: 'agent',
          args: [],
          env: {}
        },
        'manual:agent',
        undefined
      )

      expect(handle.promptCapabilities).toEqual({
        image: true,
        audio: true,
        embeddedContext: true
      })
      expect(handle.sessionCapabilities).toEqual({
        list: {},
        resume: {},
        close: {},
        fork: {}
      })
      expect(handle.supportsLoadSession).toBe(true)
      expect(handle.supportsSessionList).toBe(true)
      expect(handle.supportsSessionResume).toBe(true)
      expect(handle.supportsSessionClose).toBe(true)
      expect(handle.supportsSessionFork).toBe(true)
      expect(handle.authMethods).toEqual([{ id: 'terminal', name: 'Terminal', type: 'terminal' }])
      const clientCapabilities = sdkMock.initialize.mock.calls.at(-1)?.[0].clientCapabilities
      if (terminalAuthAvailable) expect(clientCapabilities.auth).toEqual({ terminal: true })
      else expect(clientCapabilities.auth).toBeUndefined()
      const received = vi.fn()
      const wrongConnection = vi.fn()
      manager.registerExtensionListener('remote', handle.connectionId, received)
      manager.registerExtensionListener('remote', 'other-connection', wrongConnection)
      const usage = {
        sessionId: 'remote',
        usage: { inputTokens: 12, outputTokens: 4, cacheReadInputTokens: 0 },
        modelUsage: {}
      }
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: '_lody/session/usage_update', params: usage })}\n`
      )
      await vi.waitFor(() =>
        expect(received).toHaveBeenCalledExactlyOnceWith({
          method: '_lody/session/usage_update',
          params: usage
        })
      )
      expect(wrongConnection).not.toHaveBeenCalled()
      child.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: '_lody/session/usage_update', params: { ...usage, usage: { ...usage.usage, inputTokens: -1 } } })}\n`
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(received).toHaveBeenCalledTimes(1)
      handle.connection.close()
      expect(handle.capabilitySnapshot?.supports).toEqual({
        loadSession: true,
        sessionList: true,
        sessionResume: true,
        sessionClose: true,
        sessionFork: true
      })
    }
  )
})
