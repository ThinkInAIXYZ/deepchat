import type { DeepchatBridge } from '@shared/contracts/bridge'
import { createBrowserClient } from '../../../src/renderer/api/BrowserClient'
import { createChatClient } from '../../../src/renderer/api/ChatClient'
import { createConfigClient } from '../../../src/renderer/api/ConfigClient'
import { createModelClient } from '../../../src/renderer/api/ModelClient'
import { createProviderClient } from '../../../src/renderer/api/ProviderClient'
import { createSessionClient } from '../../../src/renderer/api/SessionClient'
import { createSettingsClient } from '../../../src/renderer/api/SettingsClient'

describe('renderer api clients', () => {
  function createBridge(): DeepchatBridge {
    return {
      invoke: vi
        .fn()
        .mockImplementation(async (routeName: string, payload?: Record<string, unknown>) => {
          switch (routeName) {
            case 'config.getEntries':
              return { version: 0, values: {} }
            case 'config.updateEntries':
              return {
                version: 1,
                values: Object.fromEntries(
                  Array.isArray(payload?.changes)
                    ? payload.changes
                        .filter(
                          (change): change is { key: string; value: unknown } =>
                            Boolean(change) &&
                            typeof change === 'object' &&
                            typeof (change as { key?: unknown }).key === 'string'
                        )
                        .map((change) => [change.key, change.value])
                    : []
                )
              }
            case 'config.getSystemPrompts':
              return { prompts: [], defaultPromptId: 'empty', prompt: '' }
            case 'config.getDefaultProjectPath':
              return { path: null }
            case 'providers.list':
            case 'providers.listSummaries':
              return { providers: [] }
            case 'providers.getRateLimitStatus':
              return {
                status: {
                  config: { enabled: false, qpsLimit: 1 },
                  currentQps: 0,
                  queueLength: 0,
                  lastRequestTime: 0
                }
              }
            case 'providers.refreshModels':
              return { success: true }
            case 'models.getConfig':
              return {
                config: {
                  maxTokens: 4096,
                  contextLength: 128000,
                  temperature: 1,
                  vision: true,
                  functionCall: true,
                  reasoning: false,
                  type: 'chat'
                }
              }
            case 'models.setConfig':
              return { config: payload?.config ?? {} }
            case 'models.getCapabilities':
              return {
                capabilities: {
                  supportsReasoning: true,
                  reasoningPortrait: null,
                  thinkingBudgetRange: null,
                  supportsSearch: null,
                  searchDefaults: null,
                  supportsTemperatureControl: true,
                  temperatureCapability: true
                }
              }
            case 'browser.updateCurrentWindowBounds':
              return { updated: true }
            default:
              return {}
          }
        }),
      on: vi.fn(() => vi.fn())
    }
  }

  it('routes settings calls through the shared registry names', async () => {
    const bridge = createBridge()
    const client = createSettingsClient(bridge)

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
    const sessionClient = createSessionClient(bridge)
    const chatClient = createChatClient(bridge)
    const providerClient = createProviderClient(bridge)

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

  it('routes phase2 config, provider, and model calls through the shared registry names', async () => {
    const bridge = createBridge()
    const configClient = createConfigClient(bridge)
    const providerClient = createProviderClient(bridge)
    const modelClient = createModelClient(bridge)

    await configClient.getSetting('input_chatMode')
    await configClient.setSetting('preferredModel', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    await configClient.getSystemPrompts()
    await configClient.getDefaultProjectPath()
    configClient.onLanguageChanged(vi.fn())
    configClient.onCustomPromptsChanged(vi.fn())

    await providerClient.getProviderSummaries()
    await providerClient.getProviderRateLimitStatus('openai')
    await providerClient.refreshModels('openai')
    providerClient.onProvidersChanged(vi.fn())

    await modelClient.getModelConfig('gpt-5.4', 'openai')
    await modelClient.setModelConfig('gpt-5.4', 'openai', {
      maxTokens: 4096,
      contextLength: 128000,
      temperature: 1,
      vision: true,
      functionCall: true,
      reasoning: false,
      type: 'chat'
    })
    await modelClient.getCapabilities('openai', 'gpt-5.4')
    modelClient.onModelsChanged(vi.fn())
    modelClient.onModelStatusChanged(vi.fn())
    modelClient.onModelConfigChanged(vi.fn())

    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'config.getEntries', {
      keys: ['input_chatMode']
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'config.updateEntries', {
      changes: [
        {
          key: 'preferredModel',
          value: {
            providerId: 'openai',
            modelId: 'gpt-5.4'
          }
        }
      ]
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(3, 'config.getSystemPrompts', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(4, 'config.getDefaultProjectPath', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(5, 'providers.listSummaries', {})
    expect(bridge.invoke).toHaveBeenNthCalledWith(6, 'providers.getRateLimitStatus', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(7, 'providers.refreshModels', {
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(8, 'models.getConfig', {
      modelId: 'gpt-5.4',
      providerId: 'openai'
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(9, 'models.setConfig', {
      modelId: 'gpt-5.4',
      providerId: 'openai',
      config: {
        maxTokens: 4096,
        contextLength: 128000,
        temperature: 1,
        vision: true,
        functionCall: true,
        reasoning: false,
        type: 'chat'
      }
    })
    expect(bridge.invoke).toHaveBeenNthCalledWith(10, 'models.getCapabilities', {
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })
    expect(bridge.on).toHaveBeenNthCalledWith(1, 'config.language.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(
      2,
      'config.customPrompts.changed',
      expect.any(Function)
    )
    expect(bridge.on).toHaveBeenNthCalledWith(3, 'providers.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(4, 'models.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(5, 'models.status.changed', expect.any(Function))
    expect(bridge.on).toHaveBeenNthCalledWith(6, 'models.config.changed', expect.any(Function))
  })

  it('serializes browser bounds updates before invoking the bridge', async () => {
    const bridge = createBridge()
    const browserClient = createBrowserClient(bridge)
    const reactiveBounds = new Proxy(
      {
        x: 12,
        y: 34,
        width: 320,
        height: 180
      },
      {}
    )

    await browserClient.updateCurrentWindowBounds('session-1', reactiveBounds, false)

    expect(bridge.invoke).toHaveBeenCalledWith('browser.updateCurrentWindowBounds', {
      sessionId: 'session-1',
      bounds: {
        x: 12,
        y: 34,
        width: 320,
        height: 180
      },
      visible: false
    })
    expect((bridge.invoke as ReturnType<typeof vi.fn>).mock.calls[0][1].bounds).not.toBe(
      reactiveBounds
    )
  })
})
