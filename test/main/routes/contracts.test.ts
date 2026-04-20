import {
  DEEPCHAT_EVENT_CATALOG,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  settingsChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import {
  DEEPCHAT_ROUTE_CATALOG,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatStopStreamRoute,
  providersListModelsRoute,
  providersTestConnectionRoute,
  sessionsActivateRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'

describe('main kernel contracts', () => {
  it('registers the phase2 and phase3 route catalog', () => {
    expect(Object.keys(DEEPCHAT_ROUTE_CATALOG).sort()).toEqual([
      'browser.attachCurrentWindow',
      'browser.destroy',
      'browser.detach',
      'browser.getStatus',
      'browser.goBack',
      'browser.goForward',
      'browser.loadUrl',
      'browser.reload',
      'browser.updateCurrentWindowBounds',
      'chat.respondToolInteraction',
      'chat.sendMessage',
      'chat.stopStream',
      'config.addCustomPrompt',
      'config.addSystemPrompt',
      'config.clearDefaultSystemPrompt',
      'config.deleteCustomPrompt',
      'config.deleteSystemPrompt',
      'config.getAcpRegistryIconMarkup',
      'config.getAcpSharedMcpSelections',
      'config.getAcpState',
      'config.getAgentMcpSelections',
      'config.getAwsBedrockCredential',
      'config.getAzureApiVersion',
      'config.getDefaultProjectPath',
      'config.getDefaultSystemPrompt',
      'config.getEntries',
      'config.getFloatingButton',
      'config.getGeminiSafety',
      'config.getLanguage',
      'config.getMcpServers',
      'config.getShortcutKeys',
      'config.getSyncSettings',
      'config.getSystemPrompts',
      'config.getTheme',
      'config.getVoiceAiConfig',
      'config.listCustomPrompts',
      'config.resetDefaultSystemPrompt',
      'config.resetShortcutKeys',
      'config.resolveDeepChatAgentConfig',
      'config.setAcpSharedMcpSelections',
      'config.setAwsBedrockCredential',
      'config.setAzureApiVersion',
      'config.setCustomPrompts',
      'config.setDefaultProjectPath',
      'config.setDefaultSystemPrompt',
      'config.setDefaultSystemPromptId',
      'config.setFloatingButton',
      'config.setGeminiSafety',
      'config.setLanguage',
      'config.setShortcutKeys',
      'config.setSystemPrompts',
      'config.setTheme',
      'config.updateCustomPrompt',
      'config.updateEntries',
      'config.updateSyncSettings',
      'config.updateSystemPrompt',
      'config.updateVoiceAiConfig',
      'device.getAppVersion',
      'device.getInfo',
      'device.restartApp',
      'device.sanitizeSvg',
      'device.selectDirectory',
      'file.getMimeType',
      'file.isDirectory',
      'file.prepareDirectory',
      'file.prepareFile',
      'file.readFile',
      'file.writeImageBase64',
      'models.addCustom',
      'models.exportConfigs',
      'models.getCapabilities',
      'models.getConfig',
      'models.getProviderCatalog',
      'models.getProviderConfigs',
      'models.hasUserConfig',
      'models.importConfigs',
      'models.listRuntime',
      'models.removeCustom',
      'models.resetConfig',
      'models.setConfig',
      'models.setStatus',
      'models.updateCustom',
      'project.listEnvironments',
      'project.listRecent',
      'project.openDirectory',
      'project.selectDirectory',
      'providers.add',
      'providers.getAcpProcessConfigOptions',
      'providers.getRateLimitStatus',
      'providers.list',
      'providers.listDefaults',
      'providers.listModels',
      'providers.listOllamaModels',
      'providers.listOllamaRunningModels',
      'providers.pullOllamaModel',
      'providers.refreshModels',
      'providers.remove',
      'providers.reorder',
      'providers.setById',
      'providers.testConnection',
      'providers.update',
      'providers.warmupAcpProcess',
      'sessions.activate',
      'sessions.create',
      'sessions.deactivate',
      'sessions.getActive',
      'sessions.list',
      'sessions.restore',
      'settings.getSnapshot',
      'settings.listSystemFonts',
      'settings.update',
      'system.openSettings',
      'tab.captureCurrentArea',
      'tab.notifyRendererActivated',
      'tab.notifyRendererReady',
      'tab.stitchImagesWithWatermark',
      'window.closeCurrent',
      'window.closeFloatingCurrent',
      'window.getCurrentState',
      'window.minimizeCurrent',
      'window.previewFile',
      'window.toggleMaximizeCurrent',
      'workspace.expandDirectory',
      'workspace.getGitDiff',
      'workspace.getGitStatus',
      'workspace.openFile',
      'workspace.readDirectory',
      'workspace.readFilePreview',
      'workspace.register',
      'workspace.resolveMarkdownLinkedFile',
      'workspace.revealFileInFolder',
      'workspace.searchFiles',
      'workspace.unregister',
      'workspace.unwatch',
      'workspace.watch'
    ])
  })

  it('validates typed settings updates through the shared route contract', () => {
    expect(() =>
      settingsUpdateRoute.input.parse({
        changes: [{ key: 'fontSizeLevel', value: 'wrong-type' }]
      })
    ).toThrow()

    expect(
      settingsUpdateRoute.input.parse({
        changes: [
          { key: 'fontSizeLevel', value: 3 },
          { key: 'notificationsEnabled', value: true }
        ]
      })
    ).toEqual({
      changes: [
        { key: 'fontSizeLevel', value: 3 },
        { key: 'notificationsEnabled', value: true }
      ]
    })
  })

  it('validates typed settings helper routes through the shared contract catalog', () => {
    expect(settingsListSystemFontsRoute.input.parse({})).toEqual({})

    expect(
      settingsListSystemFontsRoute.output.parse({
        fonts: ['Inter', 'JetBrains Mono']
      })
    ).toEqual({
      fonts: ['Inter', 'JetBrains Mono']
    })
  })

  it('validates typed provider and tool interaction routes through the shared contract catalog', () => {
    expect(
      providersListModelsRoute.output.parse({
        providerModels: [
          {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            group: 'default',
            providerId: 'openai'
          }
        ],
        customModels: []
      })
    ).toEqual({
      providerModels: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          group: 'default',
          providerId: 'openai'
        }
      ],
      customModels: []
    })

    expect(
      chatRespondToolInteractionRoute.input.parse({
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        response: {
          kind: 'permission',
          granted: true
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })

    expect(() =>
      providersTestConnectionRoute.input.parse({
        providerId: '',
        modelId: 'gpt-5.4'
      })
    ).toThrow()
  })

  it('validates phase2 config/provider/model contracts', () => {
    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.updateEntries'].input.parse({
        changes: [{ key: 'input_deepThinking', value: 'true' }]
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.updateEntries'].input.parse({
        changes: [{ key: 'input_deepThinking', value: true }]
      })
    ).toEqual({
      changes: [{ key: 'input_deepThinking', value: true }]
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['providers.getRateLimitStatus'].input.parse({
        providerId: 'openai'
      })
    ).toEqual({
      providerId: 'openai'
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['models.getCapabilities'].output.parse({
        capabilities: {
          supportsReasoning: true,
          reasoningPortrait: null,
          thinkingBudgetRange: null,
          supportsSearch: true,
          searchDefaults: { default: true, forced: false, strategy: 'turbo' },
          supportsTemperatureControl: true,
          temperatureCapability: true
        }
      })
    ).toEqual({
      capabilities: {
        supportsReasoning: true,
        reasoningPortrait: null,
        thinkingBudgetRange: null,
        supportsSearch: true,
        searchDefaults: { default: true, forced: false, strategy: 'turbo' },
        supportsTemperatureControl: true,
        temperatureCapability: true
      }
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.resolveDeepChatAgentConfig'].output.parse({
        config: {
          defaultModelPreset: {
            providerId: 'openai',
            modelId: 'gpt-5.4',
            temperature: 0.4,
            contextLength: 64000,
            maxTokens: 4000,
            thinkingBudget: 2048,
            reasoningEffort: 'medium',
            verbosity: 'medium',
            forceInterleavedThinkingCompat: true
          },
          assistantModel: null,
          visionModel: null,
          systemPrompt: 'system',
          permissionMode: 'full_access',
          disabledAgentTools: ['tool-a'],
          subagentEnabled: true,
          defaultProjectPath: null
        }
      })
    ).toEqual({
      config: {
        defaultModelPreset: {
          providerId: 'openai',
          modelId: 'gpt-5.4',
          temperature: 0.4,
          contextLength: 64000,
          maxTokens: 4000,
          thinkingBudget: 2048,
          reasoningEffort: 'medium',
          verbosity: 'medium',
          forceInterleavedThinkingCompat: true
        },
        assistantModel: null,
        visionModel: null,
        systemPrompt: 'system',
        permissionMode: 'full_access',
        disabledAgentTools: ['tool-a'],
        subagentEnabled: true,
        defaultProjectPath: null
      }
    })
  })

  it('registers the phase2 and phase3 typed event catalog', () => {
    expect(Object.keys(DEEPCHAT_EVENT_CATALOG).sort()).toEqual([
      'browser.open.requested',
      'browser.status.changed',
      'chat.stream.completed',
      'chat.stream.failed',
      'chat.stream.updated',
      'config.agents.changed',
      'config.customPrompts.changed',
      'config.defaultProjectPath.changed',
      'config.floatingButton.changed',
      'config.language.changed',
      'config.shortcutKeys.changed',
      'config.syncSettings.changed',
      'config.systemPrompts.changed',
      'config.systemTheme.changed',
      'config.theme.changed',
      'models.changed',
      'models.config.changed',
      'models.status.changed',
      'providers.changed',
      'sessions.updated',
      'settings.changed',
      'window.state.changed',
      'workspace.invalidated'
    ])
  })

  it('validates typed chat stream payloads', () => {
    expect(() =>
      chatStreamUpdatedEvent.payload.parse({
        kind: 'snapshot',
        requestId: 'req-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        updatedAt: Date.now(),
        blocks: [
          {
            type: 'content',
            status: 'success',
            timestamp: Date.now(),
            content: 'hello'
          }
        ]
      })
    ).not.toThrow()

    expect(() =>
      chatStreamFailedEvent.payload.parse({
        requestId: 'req-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        failedAt: Date.now()
      })
    ).toThrow()
  })
})
