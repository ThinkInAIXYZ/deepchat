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
  providersListSummariesRoute,
  providersTestConnectionRoute,
  sessionsActivateRoute,
  sessionsGetGenerationSettingsRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  sessionsUpdateGenerationSettingsRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'
import { SessionGenerationSettingsPatchSchema } from '@shared/contracts/common'

describe('main kernel contracts', () => {
  it('registers typed route catalog entries through phase4', () => {
    const routeKeys = Object.keys(DEEPCHAT_ROUTE_CATALOG).sort()

    expect(routeKeys).toEqual(
      expect.arrayContaining([
        'browser.attachCurrentWindow',
        'chat.sendMessage',
        'config.resolveDeepChatAgentConfig',
        'dialog.error',
        'dialog.respond',
        'mcp.addServer',
        'mcp.callTool',
        'mcp.cancelSamplingRequest',
        'mcp.getClients',
        'mcp.getPrompt',
        'mcp.listToolDefinitions',
        'mcp.readResource',
        'mcp.submitSamplingDecision',
        'mcp.updateServer',
        'providers.getAcpProcessConfigOptions',
        'providers.listSummaries',
        'providers.pullOllamaModel',
        'sessions.activate',
        'sessions.clearMessages',
        'sessions.convertPendingInputToSteer',
        'sessions.delete',
        'sessions.deleteMessage',
        'sessions.deletePendingInput',
        'sessions.editUserMessage',
        'sessions.ensureAcpDraft',
        'sessions.export',
        'sessions.fork',
        'sessions.getAcpSessionCommands',
        'sessions.getAcpSessionConfigOptions',
        'sessions.getAgents',
        'sessions.getDisabledAgentTools',
        'sessions.getGenerationSettings',
        'sessions.getPermissionMode',
        'sessions.getSearchResults',
        'sessions.listMessageTraces',
        'sessions.listPendingInputs',
        'sessions.moveQueuedInput',
        'sessions.queuePendingInput',
        'sessions.rename',
        'sessions.resumePendingQueue',
        'sessions.retryMessage',
        'sessions.searchHistory',
        'sessions.setAcpSessionConfigOption',
        'sessions.setModel',
        'sessions.setPermissionMode',
        'sessions.setProjectDir',
        'sessions.setSubagentEnabled',
        'sessions.togglePinned',
        'sessions.translateText',
        'sessions.updateDisabledAgentTools',
        'sessions.updateGenerationSettings',
        'sessions.updateQueuedInput',
        'skills.getActive',
        'skills.installFromFolder',
        'skills.installFromUrl',
        'skills.listMetadata',
        'skills.openFolder',
        'skills.setActive',
        'sync.getBackupStatus',
        'sync.import',
        'sync.listBackups',
        'sync.startBackup',
        'tools.listDefinitions',
        'upgrade.check',
        'upgrade.clearMock',
        'upgrade.getStatus',
        'upgrade.mockDownloaded',
        'upgrade.openDownload',
        'upgrade.restartToUpdate',
        'upgrade.startDownload',
        'workspace.watch'
      ])
    )
    expect(new Set(routeKeys).size).toBe(routeKeys.length)
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
          { key: 'privacyModeEnabled', value: true }
        ]
      })
    ).toEqual({
      changes: [
        { key: 'fontSizeLevel', value: 3 },
        { key: 'privacyModeEnabled', value: true }
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

  it('preserves timeout in session generation settings contracts', () => {
    expect(SessionGenerationSettingsPatchSchema.parse({ timeout: 5000 })).toEqual({
      timeout: 5000
    })

    expect(
      sessionsUpdateGenerationSettingsRoute.input.parse({
        sessionId: 'session-1',
        settings: {
          timeout: 5000
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      settings: {
        timeout: 5000
      }
    })

    expect(
      sessionsGetGenerationSettingsRoute.output.parse({
        settings: {
          systemPrompt: '',
          temperature: 0.7,
          contextLength: 32000,
          maxTokens: 4096,
          timeout: 5000
        }
      })
    ).toEqual({
      settings: {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 4096,
        timeout: 5000
      }
    })

    expect(
      sessionsCreateRoute.input.parse({
        agentId: 'deepchat',
        message: 'hello',
        generationSettings: {
          timeout: 5000
        }
      })
    ).toEqual({
      agentId: 'deepchat',
      message: 'hello',
      generationSettings: {
        timeout: 5000
      }
    })
  })

  it('accepts prepared attachment metadata dates in message route contracts', () => {
    const fileCreated = new Date('2024-01-01T00:00:00.000Z')
    const fileModified = new Date('2024-01-02T00:00:00.000Z')
    const pdfAttachment = {
      name: 'sample.pdf',
      path: '/tmp/sample.pdf',
      mimeType: 'application/pdf',
      content: '# PDF file description',
      token: 128,
      metadata: {
        fileName: 'sample.pdf',
        fileSize: 1024,
        fileDescription: 'PDF Document',
        fileCreated,
        fileModified
      }
    }

    expect(
      sessionsCreateRoute.input.parse({
        agentId: 'deepchat',
        message: 'summarize this',
        files: [pdfAttachment]
      })
    ).toEqual({
      agentId: 'deepchat',
      message: 'summarize this',
      files: [pdfAttachment]
    })

    expect(
      chatSendMessageRoute.input.parse({
        sessionId: 'session-1',
        content: {
          text: 'summarize this',
          files: [pdfAttachment]
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      content: {
        text: 'summarize this',
        files: [pdfAttachment]
      }
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

    expect(
      providersListSummariesRoute.output.parse({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            apiType: 'openai',
            apiKey: 'sk-test',
            baseUrl: 'https://api.openai.com/v1',
            enable: true
          }
        ]
      })
    ).toEqual({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          apiType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          enable: true
        }
      ]
    })
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

  it('registers typed event catalog entries through phase4', () => {
    const eventKeys = Object.keys(DEEPCHAT_EVENT_CATALOG).sort()

    expect(eventKeys).toEqual(
      expect.arrayContaining([
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
        'dialog.requested',
        'mcp.config.changed',
        'mcp.sampling.cancelled',
        'mcp.sampling.decision',
        'mcp.sampling.request',
        'mcp.server.started',
        'mcp.server.status.changed',
        'mcp.server.stopped',
        'mcp.toolCall.result',
        'models.changed',
        'models.config.changed',
        'models.status.changed',
        'providers.changed',
        'providers.ollama.pull.progress',
        'sessions.acp.commands.ready',
        'sessions.acp.configOptions.ready',
        'sessions.pendingInputs.changed',
        'sessions.status.changed',
        'sessions.updated',
        'settings.changed',
        'startup.workload.changed',
        'skills.catalog.changed',
        'skills.session.changed',
        'sync.backup.completed',
        'sync.backup.error',
        'sync.backup.started',
        'sync.backup.status.changed',
        'sync.import.completed',
        'sync.import.error',
        'sync.import.started',
        'upgrade.error',
        'upgrade.progress',
        'upgrade.status.changed',
        'upgrade.willRestart',
        'window.state.changed',
        'workspace.invalidated'
      ])
    )
    expect(new Set(eventKeys).size).toBe(eventKeys.length)
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
