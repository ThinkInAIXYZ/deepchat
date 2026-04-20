import type { DeepchatBridge } from '@shared/contracts/bridge'
import { ChatClient } from '../../../src/renderer/api/ChatClient'
import { ProviderClient } from '../../../src/renderer/api/ProviderClient'
import { SessionClient } from '../../../src/renderer/api/SessionClient'
import { SettingsClient } from '../../../src/renderer/api/SettingsClient'

describe('renderer api clients', () => {
  function createBridge(): DeepchatBridge {
    return {
      invoke: vi.fn().mockResolvedValue({}),
      on: vi.fn(() => vi.fn())
    }
  }

  it('routes settings calls through the shared registry names', async () => {
    const bridge = createBridge()
    const client = new SettingsClient(bridge)

    await client.getSnapshot(['fontSizeLevel'])
    await client.getSystemFonts()
    await client.update([{ key: 'fontSizeLevel', value: 3 }])
    await client.openSettings({ routeName: 'settings-display', section: 'fonts' })
    client.onChanged(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'settings.getSnapshot', {
      keys: ['fontSizeLevel']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'settings.listSystemFonts', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'settings.update', {
      changes: [{ key: 'fontSizeLevel', value: 3 }]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'system.openSettings', {
      routeName: 'settings-display',
      section: 'fonts'
    })
    expect(bridge.on).toHaveBeenCalledWith('settings.changed', expect.any(Function))
  })

  it('routes session and chat calls through the shared registry names', async () => {
    const bridge = createBridge()
    const sessionClient = new SessionClient(bridge)
    const chatClient = new ChatClient(bridge)
    const providerClient = new ProviderClient(bridge)

    await sessionClient.create({
      agentId: 'deepchat',
      message: 'hello'
    })
    await sessionClient.restore('session-1')
    await sessionClient.list({ includeSubagents: true })
    await sessionClient.activate('session-1')
    await sessionClient.deactivate()
    await sessionClient.getActive()
    sessionClient.onUpdated(vi.fn())
    await chatClient.sendMessage('session-1', 'follow up')
    await chatClient.stopStream({ requestId: 'message-1' })
    await chatClient.respondToolInteraction({
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })
    await providerClient.listModels('openai')
    await providerClient.testConnection({
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    chatClient.onStreamUpdated(vi.fn())
    chatClient.onStreamCompleted(vi.fn())
    chatClient.onStreamFailed(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'sessions.create', {
      agentId: 'deepchat',
      message: 'hello'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'sessions.restore', {
      sessionId: 'session-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'sessions.list', {
      includeSubagents: true
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'sessions.activate', {
      sessionId: 'session-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'sessions.deactivate', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'sessions.getActive', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'chat.sendMessage', {
      sessionId: 'session-1',
      content: 'follow up'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'chat.stopStream', {
      requestId: 'message-1'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'chat.respondToolInteraction', {
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'providers.listModels', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(11, 'providers.testConnection', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'sessions.updated', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(2, 'chat.stream.updated', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'chat.stream.completed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(4, 'chat.stream.failed', expect.any(Function))
  })
})
