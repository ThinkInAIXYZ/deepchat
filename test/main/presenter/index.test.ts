import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Presenter,
  resolveConversationSubagentCapability,
  routeDeepChatAgentMemoryMaintenanceConfigChanged
} from '@/presenter'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/presenter/agentRepository'
import logger from '@shared/logger'

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {}
  }
}))

describe('Presenter startup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps MCP initialization running when plugin discovery fails', async () => {
    const pluginError = new Error('corrupt plugin package')
    const presenter = Object.create(Presenter.prototype) as any
    presenter.pluginPresenter = {
      initialize: vi.fn().mockRejectedValue(pluginError)
    }
    presenter.mcpPresenter = {
      initialize: vi.fn().mockResolvedValue(undefined)
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await presenter.initializeMcp()

    expect(presenter.pluginPresenter.initialize).toHaveBeenCalledOnce()
    expect(presenter.mcpPresenter.initialize).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      '[PluginHost] Failed to initialize plugins:',
      pluginError
    )
  })
})

describe('Presenter shutdown', () => {
  function createDestroyPresenter() {
    const presenter = Object.create(Presenter.prototype) as any
    presenter.cronJobs = { stop: vi.fn() }
    presenter.pluginPresenter = { shutdown: vi.fn() }
    presenter.mcpPresenter = { shutdown: vi.fn() }
    presenter.destroyRemoteControl = vi.fn()
    presenter.floatingButtonPresenter = { destroy: vi.fn() }
    presenter.tabPresenter = { destroy: vi.fn() }
    presenter.llmproviderPresenter = { shutdownAcpRuntime: vi.fn() }
    presenter.shortcutPresenter = { destroy: vi.fn() }
    presenter.syncPresenter = { destroy: vi.fn() }
    presenter.notificationPresenter = { clearAllNotifications: vi.fn() }
    presenter.knowledgePresenter = { destroy: vi.fn() }
    presenter.workspacePresenter = { destroy: vi.fn() }
    presenter.skillPresenter = { destroy: vi.fn() }
    presenter.skillSyncPresenter = { destroy: vi.fn() }
    return presenter
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fences ingestion, lets Memory disposal release running work, then closes SQLite', async () => {
    const order: string[] = []
    let settleRunning!: () => void
    const running = new Promise<void>((resolve) => {
      settleRunning = resolve
    }).then(() => {
      order.push('chain-settled')
      return { timedOut: false, pendingSessions: [] }
    })
    const presenter = createDestroyPresenter()
    presenter.memoryIngestionObserver = {
      drainAndFence: vi.fn(() => {
        order.push('fence')
        return running
      })
    }
    presenter.memoryPresenter = {
      dispose: vi.fn(async () => {
        order.push('memory-dispose')
        settleRunning()
      })
    }
    presenter.sqlitePresenter = {
      close: vi.fn(() => {
        order.push('sqlite-close')
      })
    }
    await presenter.destroy()

    expect(order).toEqual(['fence', 'memory-dispose', 'chain-settled', 'sqlite-close'])
  })

  it('logs a bounded drain timeout and still closes SQLite after Memory disposal', async () => {
    const order: string[] = []
    const presenter = createDestroyPresenter()
    presenter.memoryIngestionObserver = {
      drainAndFence: vi.fn(() => {
        order.push('fence')
        return Promise.resolve({ timedOut: true, pendingSessions: ['s1'] })
      })
    }
    presenter.memoryPresenter = {
      dispose: vi.fn(() => {
        order.push('memory-dispose')
      })
    }
    presenter.sqlitePresenter = {
      close: vi.fn(() => {
        order.push('sqlite-close')
      })
    }
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    await presenter.destroy()

    expect(order).toEqual(['fence', 'memory-dispose', 'sqlite-close'])
    expect(warn).toHaveBeenCalledWith(
      '[Presenter] Memory ingestion drain timed out with 1 pending session(s); late writes remain fenced.'
    )
  })

  it('reports dispose and drain failures but still attempts SQLite close', async () => {
    const order: string[] = []
    const presenter = createDestroyPresenter()
    presenter.memoryIngestionObserver = {
      drainAndFence: vi.fn(() => {
        order.push('fence-attempt')
        throw new Error('drain failed')
      })
    }
    presenter.memoryPresenter = {
      dispose: vi.fn(() => {
        order.push('memory-dispose')
        throw new Error('dispose failed')
      })
    }
    presenter.sqlitePresenter = {
      close: vi.fn(() => {
        order.push('sqlite-close')
      })
    }
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    await presenter.destroy()

    expect(order).toEqual(['fence-attempt', 'memory-dispose', 'sqlite-close'])
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('destroy.memoryPresenter.dispose failed'),
        expect.stringContaining('destroy.memoryIngestionObserver.drainAndFence failed')
      ])
    )
  })
})

describe('DeepChat agent memory maintenance config routing', () => {
  it('routes builtin config changes to builtin fan-out', () => {
    const memoryPresenter = {
      onBuiltinDeepChatMemoryMaintenanceConfigChanged: vi.fn(),
      onAgentMemoryMaintenanceConfigChanged: vi.fn()
    }

    routeDeepChatAgentMemoryMaintenanceConfigChanged(memoryPresenter, BUILTIN_DEEPCHAT_AGENT_ID)

    expect(memoryPresenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged).toHaveBeenCalledOnce()
    expect(memoryPresenter.onAgentMemoryMaintenanceConfigChanged).not.toHaveBeenCalled()
  })

  it('routes custom agent config changes to single-agent arm', () => {
    const memoryPresenter = {
      onBuiltinDeepChatMemoryMaintenanceConfigChanged: vi.fn(),
      onAgentMemoryMaintenanceConfigChanged: vi.fn()
    }

    routeDeepChatAgentMemoryMaintenanceConfigChanged(memoryPresenter, 'writer')

    expect(memoryPresenter.onAgentMemoryMaintenanceConfigChanged).toHaveBeenCalledWith('writer')
    expect(memoryPresenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged).not.toHaveBeenCalled()
  })
})

describe('Conversation Subagent capability resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the current Agent policy to regular DeepChat parent sessions', async () => {
    const resolveConfig = vi.fn().mockResolvedValue({
      subagentEnabled: true,
      subagents: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review an independent task.'
        }
      ]
    })

    await expect(
      resolveConversationSubagentCapability({
        sessionId: 'session-1',
        agentId: 'deepchat',
        agentType: 'deepchat',
        sessionKind: 'regular',
        resolveConfig
      })
    ).resolves.toMatchObject({
      available: true,
      slots: [expect.objectContaining({ id: 'reviewer' })]
    })
    expect(resolveConfig).toHaveBeenCalledWith('deepchat')
  })

  it('fails closed without rejecting when Agent policy resolution fails', async () => {
    const error = new Error('config unavailable')
    const resolveConfig = vi.fn().mockRejectedValue(error)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      resolveConversationSubagentCapability({
        sessionId: 'session-1',
        agentId: 'deepchat',
        agentType: 'deepchat',
        sessionKind: 'regular',
        resolveConfig
      })
    ).resolves.toMatchObject({
      available: false,
      reason: 'no_valid_slots'
    })
    expect(resolveConfig).toHaveBeenCalledWith('deepchat')
    expect(warn).toHaveBeenCalledWith('[Presenter] Failed to resolve Subagent policy:', {
      sessionId: 'session-1',
      agentId: 'deepchat',
      error
    })
  })
})
