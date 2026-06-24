import { afterEach, describe, expect, it, vi } from 'vitest'
import { Presenter, routeDeepChatAgentMemoryMaintenanceConfigChanged } from '@/presenter'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/presenter/agentRepository'

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
