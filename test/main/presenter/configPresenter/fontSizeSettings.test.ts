import { beforeEach, describe, expect, it, vi } from 'vitest'

const eventBusMocks = vi.hoisted(() => ({
  on: vi.fn(),
  send: vi.fn(),
  sendToMain: vi.fn()
}))

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/eventbus', () => ({
  eventBus: {
    on: eventBusMocks.on,
    send: eventBusMocks.send,
    sendToMain: eventBusMocks.sendToMain
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

vi.mock('@/presenter', () => ({
  presenter: {}
}))

import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { ConfigPresenter } from '@/presenter/configPresenter'

describe('ConfigPresenter font size settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes typed settings.changed without the retired raw font-size renderer event', () => {
    const store = {
      set: vi.fn()
    }
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      agentRepository: null,
      getSettingsStoreForKey: vi.fn(() => store)
    }) as ConfigPresenter & {
      getSettingsStoreForKey: ReturnType<typeof vi.fn>
    }

    presenter.setSetting('fontSizeLevel', 4)

    expect(store.set).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(eventBus.sendToMain).toHaveBeenCalledWith(
      CONFIG_EVENTS.SETTING_CHANGED,
      'fontSizeLevel',
      4
    )
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('settings.changed', {
      changedKeys: ['fontSizeLevel'],
      version: expect.any(Number),
      values: {
        fontSizeLevel: 4
      }
    })
  })
})

describe('ConfigPresenter NowledgeMem settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists config without the retired raw config renderer event', async () => {
    const store = {
      set: vi.fn()
    }
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {
      getSettingsStoreForKey: vi.fn(() => store)
    }) as ConfigPresenter & {
      getSettingsStoreForKey: ReturnType<typeof vi.fn>
    }
    const config = {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'test-key',
      timeout: 30000
    }

    await presenter.setNowledgeMemConfig(config)

    expect(store.set).toHaveBeenCalledWith('nowledgeMemConfig', config)
  })
})

describe('ConfigPresenter ACP agent notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes typed session refresh instead of the retired raw session list event', () => {
    const presenter = Object.assign(Object.create(ConfigPresenter.prototype), {}) as ConfigPresenter

    ;(presenter as any).notifyAcpAgentsChanged(['agent-1'])

    expect(eventBus.sendToMain).toHaveBeenCalledWith(CONFIG_EVENTS.MODEL_LIST_CHANGED, 'acp')
    expect(eventBus.sendToMain).toHaveBeenCalledWith(CONFIG_EVENTS.AGENTS_CHANGED, {
      agentIds: ['agent-1']
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('models.changed', {
      reason: 'agents',
      providerId: 'acp',
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.updated', {
      sessionIds: [],
      reason: 'list-refreshed'
    })
    expect(eventBus.send).not.toHaveBeenCalled()
  })
})
