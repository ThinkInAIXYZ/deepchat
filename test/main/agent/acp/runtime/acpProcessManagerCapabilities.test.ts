import { EventEmitter } from 'events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const sdkMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  initializeResponse: {
    protocolVersion: 1,
    agentInfo: { name: 'Agent One', version: '1.0.0' },
    agentCapabilities: {
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

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: 1,
  ClientSideConnection: class {
    closed = new Promise<void>(() => {})
    initialize = sdkMock.initialize
  }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
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
      sdkMock.initialize.mockResolvedValue(sdkMock.initializeResponse)
      const { AcpProcessManager } = await import('@/agent/acp/runtime/acpProcessManager')
      const manager = new AcpProcessManager({
        publishEvent: vi.fn(),
        providerId: 'acp',
        resolveLaunchSpec: vi.fn(),
        terminalAuthAvailable
      })
      const child = new MockChild()
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
