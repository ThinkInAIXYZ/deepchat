import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyRenderer = vi.hoisted(() => vi.fn())

async function loadChatMode(setSetting: ReturnType<typeof vi.fn>) {
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
  return chatMode
}

describe('useChatMode', () => {
  beforeEach(() => {
    vi.resetModules()
    notifyRenderer.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('restores the previous mode and notifies when saving fails', async () => {
    const setSetting = vi.fn()
    const chatMode = await loadChatMode(setSetting)

    setSetting.mockRejectedValueOnce(new Error('disk full'))
    await chatMode.setMode('acp agent')

    expect(chatMode.currentMode.value).toBe('agent')
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.mode.saveFailed',
      title: 'common.error.operationFailed',
      description: 'chat.mode.saveFailed'
    })
  })

  it('does not revert or notify when an older save fails', async () => {
    const setSetting = vi.fn()
    const chatMode = await loadChatMode(setSetting)
    let rejectOlderSave: (reason: Error) => void = () => undefined
    const olderSave = new Promise<void>((_, reject) => {
      rejectOlderSave = reject
    })

    setSetting.mockReturnValueOnce(olderSave).mockResolvedValueOnce(undefined)
    const olderUpdate = chatMode.setMode('acp agent')
    await chatMode.setMode('agent')
    rejectOlderSave(new Error('stale failure'))
    await olderUpdate

    expect(chatMode.currentMode.value).toBe('agent')
    expect(notifyRenderer).not.toHaveBeenCalled()
  })
})
