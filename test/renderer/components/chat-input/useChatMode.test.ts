import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyRenderer = vi.hoisted(() => vi.fn())

describe('useChatMode', () => {
  beforeEach(() => {
    vi.resetModules()
    notifyRenderer.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('restores the previous mode and notifies when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const setSetting = vi.fn()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({ t: (key: string) => key })
    }))
    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: () => ({
        getAcpAgents: vi.fn().mockResolvedValue([{ id: 'acp-agent' }]),
        getAcpEnabled: vi.fn().mockResolvedValue(true),
        getSetting: vi.fn().mockResolvedValue('agent'),
        onAgentsChanged: vi.fn(),
        setSetting
      })
    }))
    vi.doMock('@api/ModelClient', () => ({
      createModelClient: () => ({ onModelsChanged: vi.fn() })
    }))
    vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({ notifyRenderer }))

    const { useChatMode } = await import('@/components/chat-input/composables/useChatMode')
    const chatMode = useChatMode()
    await flushPromises()

    setSetting.mockRejectedValueOnce(new Error('disk full'))
    await chatMode.setMode('acp agent')

    expect(chatMode.currentMode.value).toBe('agent')
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.mode.saveFailed',
      title: 'common.error.operationFailed',
      description: 'common.notifications.actionFailed'
    })
  })
})
