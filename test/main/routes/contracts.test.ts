import {
  DEEPCHAT_EVENT_CATALOG,
  appRuntimeShortcutRequestedEvent,
  appRuntimeStartDeeplinkRequestedEvent,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  contextMenuAskAiRequestedEvent,
  contextMenuTranslateRequestedEvent,
  settingsChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import {
  DEEPCHAT_ROUTE_CATALOG,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
  pluginsGetRoute,
  pluginsInvokeActionRoute,
  providersListModelsRoute,
  providersListSummariesRoute,
  providersTestConnectionRoute,
  modelsTranscribeAudioRoute,
  configListAgentsRoute,
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  oauthOpenAICodexGetStatusRoute,
  sessionsActivateRoute,
  sessionsCompactRoute,
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
  systemOpenSettingsRoute,
  windowConsumePendingSettingsProviderInstallRoute,
  windowRequeuePendingSettingsProviderInstallRoute
} from '@shared/contracts/routes'
import { SessionGenerationSettingsPatchSchema } from '@shared/contracts/common'

describe('main kernel contracts', () => {
  it('registers typed route catalog entries through phase4', () => {
    const routeKeys = Object.keys(DEEPCHAT_ROUTE_CATALOG).sort()

    expect(routeKeys).toEqual(
      expect.arrayContaining([
        'acpTerminal.input',
        'acpTerminal.kill',
        'browser.attachCurrentWindow',
        'browser.clearSandboxData',
        'databaseSecurity.repairSchema',
        'config.addManualAcpAgent',
        'config.ensureAcpAgentInstalled',
        'config.getProxySettings',
        'config.getSkillDraftSuggestions',
        'config.getHooksNotifications',
        'config.getUpdateChannel',
        'config.listAcpRegistryAgents',
        'config.listManualAcpAgents',
        'config.openLoggingFolder',
        'config.createDeepChatAgent',
        'config.deleteDeepChatAgent',
        'config.refreshAcpRegistry',
        'config.refreshProviderDb',
        'config.removeManualAcpAgent',
        'config.repairAcpAgent',
        'chat.sendMessage',
        'chat.steerActiveTurn',
        'config.resolveDeepChatAgentConfig',
        'config.setAcpAgentEnabled',
        'config.setAcpAgentEnvOverride',
        'config.setAcpEnabled',
        'config.setCustomProxyUrl',
        'config.setProxyMode',
        'config.setSkillDraftSuggestions',
        'config.setHooksNotifications',
        'config.setUpdateChannel',
        'config.testHookCommand',
        'config.uninstallAcpRegistryAgent',
        'config.updateManualAcpAgent',
        'config.updateDeepChatAgent',
        'device.resetDataByType',
        'device.selectFiles',
        'dialog.error',
        'dialog.respond',
        'knowledge.addFile',
        'knowledge.deleteFile',
        'knowledge.getSeparatorsForLanguage',
        'knowledge.getSupportedFileExtensions',
        'knowledge.getSupportedLanguages',
        'knowledge.isSupported',
        'knowledge.listFiles',
        'knowledge.pauseAllRunningTasks',
        'knowledge.reAddFile',
        'knowledge.resumeAllPausedTasks',
        'knowledge.similarityQuery',
        'knowledge.validateFile',
        'mcp.addServer',
        'mcp.callTool',
        'mcp.cancelSamplingRequest',
        'mcp.getClients',
        'mcp.getPrompt',
        'mcp.listToolDefinitions',
        'mcp.readResource',
        'mcp.router.getApiKey',
        'mcp.router.installServer',
        'mcp.router.isServerInstalled',
        'mcp.router.listServers',
        'mcp.router.setApiKey',
        'mcp.router.updateServersAuth',
        'mcp.submitSamplingDecision',
        'mcp.updateServer',
        'nowledgeMem.getConfig',
        'nowledgeMem.testConnection',
        'nowledgeMem.updateConfig',
        'oauth.githubCopilot.startDeviceFlowLogin',
        'oauth.githubCopilot.startLogin',
        'oauth.openaiCodex.cancelLogin',
        'oauth.openaiCodex.getStatus',
        'oauth.openaiCodex.logout',
        'oauth.openaiCodex.startBrowserLogin',
        'plugins.get',
        'plugins.invokeAction',
        'project.pathExists',
        'providers.getAcpProcessConfigOptions',
        'providers.getEmbeddingDimensions',
        'providers.getKeyStatus',
        'providers.listSummaries',
        'providers.pullOllamaModel',
        'providers.runAcpDebugAction',
        'providers.syncModelScopeMcpServers',
        'providers.updateRateLimit',
        'remoteControl.clearChannelPairCode',
        'remoteControl.createChannelPairCode',
        'remoteControl.getChannelBindings',
        'remoteControl.getChannelPairingSnapshot',
        'remoteControl.getChannelSettings',
        'remoteControl.getChannelStatus',
        'remoteControl.getTelegramStatus',
        'remoteControl.getWeixinIlinkStatus',
        'remoteControl.startFeishuAuth',
        'remoteControl.waitForFeishuAuth',
        'remoteControl.cancelFeishuAuth',
        'remoteControl.startFeishuInstall',
        'remoteControl.waitForFeishuInstall',
        'remoteControl.cancelFeishuInstall',
        'remoteControl.listChannels',
        'remoteControl.removeChannelBinding',
        'remoteControl.removeChannelPrincipal',
        'remoteControl.removeWeixinIlinkAccount',
        'remoteControl.restartWeixinIlinkAccount',
        'remoteControl.saveChannelSettings',
        'remoteControl.startWeixinIlinkLogin',
        'remoteControl.waitForWeixinIlinkLogin',
        'sessions.activate',
        'sessions.clearMessages',
        'sessions.compact',
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
        'sessions.getUsageDashboard',
        'sessions.listMessageTraces',
        'sessions.listPendingInputs',
        'sessions.moveQueuedInput',
        'sessions.queuePendingInput',
        'sessions.rename',
        'sessions.retryRtkHealthCheck',
        'sessions.retryMessage',
        'sessions.searchHistory',
        'sessions.setAcpSessionConfigOption',
        'sessions.setModel',
        'sessions.setPermissionMode',
        'sessions.setProjectDir',
        'sessions.setSubagentEnabled',
        'sessions.steerPendingInput',
        'sessions.togglePinned',
        'sessions.translateText',
        'sessions.updateDisabledAgentTools',
        'sessions.updateGenerationSettings',
        'sessions.updateQueuedInput',
        'skills.getActive',
        'skills.getSyncConfig',
        'skills.executeSyncDirectoryExport',
        'skills.executeSyncDirectoryImport',
        'skills.installFromGit',
        'skills.installFromFolder',
        'skills.installFromUrl',
        'skills.listCatalog',
        'skills.listMetadata',
        'skills.openFolder',
        'skills.previewSyncDirectoryExport',
        'skills.previewSyncDirectoryImport',
        'skills.readFile',
        'skills.scanGitRepo',
        'skills.setActive',
        'skills.setDisabled',
        'skills.setSyncDirectory',
        'shortcut.destroy',
        'shortcut.register',
        'shortcut.unregister',
        'skillSync.acknowledgeDiscoveries',
        'skillSync.executeAdoptAgentSkill',
        'skillSync.executeExport',
        'skillSync.executeImport',
        'skillSync.executeLinkDeepChatSkills',
        'skillSync.getAgentDetail',
        'skillSync.getAgentSkillDetail',
        'skillSync.getNewDiscoveries',
        'skillSync.getRegisteredTools',
        'skillSync.previewAdoptAgentSkill',
        'skillSync.previewExport',
        'skillSync.previewImport',
        'skillSync.previewLinkDeepChatSkills',
        'skillSync.removeAgentSkillLink',
        'skillSync.repairAgentSkillLink',
        'skillSync.scanAgents',
        'skillSync.scanExternalTools',
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
        'window.closeSettings',
        'window.consumePendingSettingsProviderInstall',
        'window.focusMain',
        'window.notifySettingsReady',
        'window.requeuePendingSettingsProviderInstall',
        'window.startGuidedOnboarding',
        'workspace.watch'
      ])
    )
    expect(new Set(routeKeys).size).toBe(routeKeys.length)
  })

  it('trims and rejects blank project path route inputs', () => {
    expect(
      DEEPCHAT_ROUTE_CATALOG['project.reorderEnvironments'].input.parse({
        paths: [' C:/workspace ']
      })
    ).toEqual({ paths: ['C:/workspace'] })
    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['project.reorderEnvironments'].input.parse({
        paths: ['   ']
      })
    ).toThrow()

    const pathRouteNames: Array<keyof typeof DEEPCHAT_ROUTE_CATALOG> = [
      'project.archiveEnvironment',
      'project.restoreEnvironment',
      'project.removeEnvironment',
      'project.openDirectory',
      'project.pathExists'
    ]

    for (const routeName of pathRouteNames) {
      expect(DEEPCHAT_ROUTE_CATALOG[routeName].input.parse({ path: ' C:/workspace ' })).toEqual({
        path: 'C:/workspace'
      })
      expect(() => DEEPCHAT_ROUTE_CATALOG[routeName].input.parse({ path: '   ' })).toThrow()
    }
  })

  it('validates plugin route payloads through concrete schemas', () => {
    expect(
      pluginsGetRoute.output.parse({
        plugin: {
          id: 'com.deepchat.plugins.fixture',
          name: 'Fixture Runtime',
          version: '1.0.0',
          publisher: 'DeepChat',
          installed: true,
          enabled: true,
          trusted: true,
          trustState: 'trusted',
          official: true,
          capabilities: ['runtime.manage'],
          runtime: {
            runtimeId: 'fixture-runtime',
            displayName: 'Fixture Runtime',
            state: 'installed',
            command: '/usr/local/bin/fixture-runtime'
          }
        }
      })
    ).toEqual({
      plugin: {
        id: 'com.deepchat.plugins.fixture',
        name: 'Fixture Runtime',
        version: '1.0.0',
        publisher: 'DeepChat',
        installed: true,
        enabled: true,
        trusted: true,
        trustState: 'trusted',
        official: true,
        capabilities: ['runtime.manage'],
        runtime: {
          runtimeId: 'fixture-runtime',
          displayName: 'Fixture Runtime',
          state: 'installed',
          command: '/usr/local/bin/fixture-runtime'
        }
      }
    })

    expect(() =>
      pluginsInvokeActionRoute.input.parse({
        pluginId: '',
        actionId: 'runtime.getStatus'
      })
    ).toThrow()
  })

  it('validates GitHub Copilot OAuth route payloads', () => {
    expect(
      oauthGithubCopilotStartLoginRoute.input.parse({
        providerId: 'github-copilot'
      })
    ).toEqual({
      providerId: 'github-copilot'
    })
    expect(
      oauthGithubCopilotStartDeviceFlowLoginRoute.output.parse({
        success: true
      })
    ).toEqual({
      success: true
    })

    expect(() =>
      oauthGithubCopilotStartDeviceFlowLoginRoute.input.parse({
        providerId: ''
      })
    ).toThrow()
  })

  it('validates OpenAI Codex OAuth route payloads', () => {
    expect(oauthOpenAICodexGetStatusRoute.input.parse({})).toEqual({})
    expect(
      oauthOpenAICodexGetStatusRoute.output.parse({
        status: {
          state: 'authenticated',
          authenticated: true,
          accountId: 'acct...1234',
          accountLabel: 'user@example.com',
          planType: 'plus',
          expiresAt: 123,
          storage: 'safeStorage'
        }
      })
    ).toEqual({
      status: {
        state: 'authenticated',
        authenticated: true,
        accountId: 'acct...1234',
        accountLabel: 'user@example.com',
        planType: 'plus',
        expiresAt: 123,
        storage: 'safeStorage'
      }
    })

    expect(
      oauthOpenAICodexGetStatusRoute.output.parse({
        status: {
          state: 'pending-browser',
          authenticated: false,
          storage: 'file'
        }
      }).status.state
    ).toBe('pending-browser')

    expect(() =>
      oauthOpenAICodexGetStatusRoute.output.parse({
        status: {
          state: 'pending-device',
          authenticated: false,
          storage: 'file'
        }
      })
    ).toThrow()
  })

  it('validates database repair and browser sandbox utility route payloads', () => {
    expect(DEEPCHAT_ROUTE_CATALOG['browser.clearSandboxData'].input.parse({})).toEqual({})

    expect(
      DEEPCHAT_ROUTE_CATALOG['databaseSecurity.repairSchema'].output.parse({
        report: {
          startedAt: 1,
          finishedAt: 2,
          status: 'healthy',
          backupPath: null,
          diagnosisBeforeRepair: {
            checkedAt: 1,
            isHealthy: true,
            issues: [],
            repairableIssues: [],
            manualIssues: []
          },
          diagnosisAfterRepair: {
            checkedAt: 2,
            isHealthy: true,
            issues: [],
            repairableIssues: [],
            manualIssues: []
          },
          repairedIssues: [],
          remainingIssues: []
        }
      })
    ).toEqual({
      report: expect.objectContaining({
        status: 'healthy',
        repairedIssues: [],
        remainingIssues: []
      })
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['databaseSecurity.repairSchema'].output.parse({
        report: {
          status: 'unknown'
        }
      })
    ).toThrow()
  })

  it('validates NowledgeMem route payloads', () => {
    expect(
      DEEPCHAT_ROUTE_CATALOG['nowledgeMem.updateConfig'].input.parse({
        config: {
          baseUrl: 'http://127.0.0.1:14242',
          apiKey: '',
          timeout: 30000
        }
      })
    ).toEqual({
      config: {
        baseUrl: 'http://127.0.0.1:14242',
        apiKey: '',
        timeout: 30000
      }
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['nowledgeMem.testConnection'].output.parse({
        result: {
          success: true,
          message: 'Connection successful'
        }
      })
    ).toEqual({
      result: {
        success: true,
        message: 'Connection successful'
      }
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['nowledgeMem.updateConfig'].input.parse({
        config: {}
      })
    ).toThrow()
  })

  it('validates skill file read route payloads', () => {
    expect(
      DEEPCHAT_ROUTE_CATALOG['skills.readFile'].input.parse({
        name: 'write-tests'
      })
    ).toEqual({
      name: 'write-tests'
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['skills.readFile'].output.parse({
        content: '# Write tests'
      })
    ).toEqual({
      content: '# Write tests'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['skills.readFile'].input.parse({
        name: ''
      })
    ).toThrow()
  })

  it('validates skill Git and sync directory route payloads', () => {
    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['skills.scanGitRepo'].input.parse({ repoUrl: '' })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['skills.installFromGit'].input.parse({
        repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
        skillNames: ['guizang-ppt-skill'],
        strategy: 'rename'
      })
    ).toEqual({
      repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
      skillNames: ['guizang-ppt-skill'],
      strategy: 'rename'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['skills.installFromGit'].input.parse({
        repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
        skillNames: ['guizang-ppt-skill'],
        strategy: 'replace'
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['skills.setSyncDirectory'].input.parse({
        skillsDirectory: '/tmp/deepchat-skills'
      })
    ).toEqual({
      skillsDirectory: '/tmp/deepchat-skills'
    })
  })

  it('validates MCP Router marketplace route payloads', () => {
    const item = {
      uuid: 'router-item-1',
      created_at: '2026-06-11T00:00:00.000Z',
      updated_at: '2026-06-11T00:00:00.000Z',
      name: 'context7',
      author_name: 'upstash',
      title: 'Context7',
      description: 'Fetch current docs',
      content: 'Documentation helper',
      server_key: 'context7',
      config_name: 'Context7',
      server_url: 'https://mcp.context7.com/mcp'
    }

    expect(
      DEEPCHAT_ROUTE_CATALOG['mcp.router.listServers'].input.parse({
        page: 1,
        limit: 20
      })
    ).toEqual({
      page: 1,
      limit: 20
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['mcp.router.listServers'].output.parse({
        servers: [item]
      })
    ).toEqual({
      servers: [item]
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['mcp.router.installServer'].output.parse({
        installed: true
      })
    ).toEqual({
      installed: true
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['mcp.router.getApiKey'].output.parse({
        key: 'router-key'
      })
    ).toEqual({
      key: 'router-key'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['mcp.router.installServer'].input.parse({
        serverKey: ''
      })
    ).toThrow()
    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['mcp.router.listServers'].input.parse({
        page: 1,
        limit: 101
      })
    ).toThrow()
  })

  it('validates remote control route payloads', () => {
    expect(DEEPCHAT_ROUTE_CATALOG['remoteControl.listChannels'].input.parse({})).toEqual({})
    expect(
      DEEPCHAT_ROUTE_CATALOG['remoteControl.getChannelSettings'].input.parse({
        channel: 'telegram'
      })
    ).toEqual({
      channel: 'telegram'
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['remoteControl.saveChannelSettings'].input.parse({
        channel: 'telegram',
        settings: {
          botToken: 'telegram-token',
          remoteEnabled: true,
          defaultAgentId: 'deepchat',
          defaultWorkdir: ''
        }
      })
    ).toEqual({
      channel: 'telegram',
      settings: {
        botToken: 'telegram-token',
        remoteEnabled: true,
        defaultAgentId: 'deepchat',
        defaultWorkdir: ''
      }
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['remoteControl.createChannelPairCode'].output.parse({
        code: '654321',
        expiresAt: 123456
      })
    ).toEqual({
      code: '654321',
      expiresAt: 123456
    })
    expect(
      DEEPCHAT_ROUTE_CATALOG['remoteControl.waitForWeixinIlinkLogin'].input.parse({
        sessionKey: 'weixin-session',
        timeoutMs: 480000
      })
    ).toEqual({
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['remoteControl.getChannelStatus'].input.parse({
        channel: 'slack'
      })
    ).toThrow()
    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['remoteControl.removeChannelPrincipal'].input.parse({
        channel: 'weixin-ilink',
        principalId: '123'
      })
    ).toThrow()
  })

  it('bounds audio transcription route payload fields', () => {
    expect(() =>
      modelsTranscribeAudioRoute.input.parse({
        providerId: 'openai',
        modelId: 'gpt-4o-transcribe',
        audioBase64: 'A'.repeat(15_000_001),
        mimeType: 'audio/wav'
      })
    ).toThrow()

    expect(() =>
      modelsTranscribeAudioRoute.input.parse({
        providerId: 'openai',
        modelId: 'gpt-4o-transcribe',
        audioBase64: 'AQID',
        mimeType: 'a'.repeat(256)
      })
    ).toThrow()
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
          { key: 'privacyModeEnabled', value: true },
          { key: 'launchAtLoginEnabled', value: true }
        ]
      })
    ).toEqual({
      changes: [
        { key: 'fontSizeLevel', value: 3 },
        { key: 'privacyModeEnabled', value: true },
        { key: 'launchAtLoginEnabled', value: true }
      ]
    })
  })

  it('validates config list agent payloads structurally', () => {
    expect(() =>
      configListAgentsRoute.output.parse({
        agents: [{ id: 'agent-1', enabled: true }]
      })
    ).toThrow()

    expect(
      configListAgentsRoute.output.parse({
        agents: [
          {
            id: 'agent-1',
            name: 'Agent One',
            type: 'acp',
            agentType: 'acp',
            enabled: true,
            source: 'registry',
            installState: {
              status: 'installed',
              distributionType: 'binary',
              installedAt: 1710000000000,
              lastCheckedAt: 1710000000000,
              installDir: 'C:/agents/agent-1',
              error: null
            }
          }
        ]
      })
    ).toEqual({
      agents: [
        {
          id: 'agent-1',
          name: 'Agent One',
          type: 'acp',
          agentType: 'acp',
          enabled: true,
          source: 'registry',
          installState: {
            status: 'installed',
            distributionType: 'binary',
            installedAt: 1710000000000,
            lastCheckedAt: 1710000000000,
            installDir: 'C:/agents/agent-1',
            error: null
          }
        }
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

  it('validates agent usage dashboard route contracts', () => {
    const dashboard = {
      recordingStartedAt: null,
      backfillStatus: {
        status: 'completed',
        startedAt: null,
        finishedAt: null,
        error: null,
        updatedAt: 123
      },
      summary: {
        messageCount: 1,
        sessionCount: 1,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 0,
        cacheHitRate: 0,
        estimatedCostUsd: null,
        mostActiveDay: {
          date: '2026-06-11',
          messageCount: 1
        }
      },
      calendar: [
        {
          date: '2026-06-11',
          messageCount: 1,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 0,
          estimatedCostUsd: null,
          level: 1
        }
      ],
      providerBreakdown: [],
      modelBreakdown: [],
      rtk: {
        scope: 'deepchat',
        enabled: true,
        effectiveEnabled: true,
        available: true,
        health: 'healthy',
        checkedAt: 123,
        source: 'bundled',
        failureStage: null,
        failureMessage: null,
        summary: {
          totalCommands: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalSavedTokens: 0,
          avgSavingsPct: 0,
          totalTimeMs: 0,
          avgTimeMs: 0
        },
        daily: []
      }
    }

    expect(
      DEEPCHAT_ROUTE_CATALOG['sessions.getUsageDashboard'].output.parse({
        dashboard
      })
    ).toEqual({ dashboard })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['sessions.getUsageDashboard'].output.parse({
        dashboard: {
          ...dashboard,
          rtk: {
            ...dashboard.rtk,
            health: 'unknown'
          }
        }
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['sessions.retryRtkHealthCheck'].output.parse({ retried: true })
    ).toEqual({
      retried: true
    })
  })

  it('preserves gpt-image-2 image settings in session generation settings contracts', () => {
    const imageGeneration = {
      size: '3840x2160',
      quality: 'high',
      outputFormat: 'webp',
      outputCompression: 80,
      background: 'opaque',
      moderation: 'low'
    } as const

    expect(SessionGenerationSettingsPatchSchema.parse({ imageGeneration })).toEqual({
      imageGeneration
    })

    expect(
      sessionsUpdateGenerationSettingsRoute.input.parse({
        sessionId: 'session-1',
        settings: {
          imageGeneration
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      settings: {
        imageGeneration
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

    expect(
      chatSteerActiveTurnRoute.input.parse({
        sessionId: 'session-1',
        content: {
          text: 'actually, focus on risks',
          files: [pdfAttachment]
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      content: {
        text: 'actually, focus on risks',
        files: [pdfAttachment]
      }
    })
  })

  it('validates manual compaction route contracts', () => {
    expect(
      sessionsCompactRoute.input.parse({
        sessionId: 'session-1'
      })
    ).toEqual({
      sessionId: 'session-1'
    })

    expect(
      sessionsCompactRoute.output.parse({
        compacted: true,
        state: {
          status: 'compacted',
          cursorOrderSeq: 3,
          summaryUpdatedAt: 123
        }
      })
    ).toEqual({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 3,
        summaryUpdatedAt: 123
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
      DEEPCHAT_ROUTE_CATALOG['config.updateEntries'].input.parse({
        changes: [
          { key: 'assistantModel', value: null },
          { key: 'maxFileSize', value: 30 * 1024 * 1024 }
        ]
      })
    ).toEqual({
      changes: [
        { key: 'assistantModel', value: null },
        { key: 'maxFileSize', value: 30 * 1024 * 1024 }
      ]
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.setProxyMode'].input.parse({
        mode: 'invalid'
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.setProxyMode'].input.parse({
        mode: 'custom'
      })
    ).toEqual({
      mode: 'custom'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.setUpdateChannel'].input.parse({
        channel: 'nightly'
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.setUpdateChannel'].input.parse({
        channel: 'beta'
      })
    ).toEqual({
      channel: 'beta'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.createDeepChatAgent'].input.parse({
        enabled: true
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.createDeepChatAgent'].input.parse({
        name: 'Writer',
        enabled: true,
        config: {
          systemPrompt: 'Write clearly',
          permissionMode: 'default'
        }
      })
    ).toEqual({
      name: 'Writer',
      enabled: true,
      config: {
        systemPrompt: 'Write clearly',
        permissionMode: 'default'
      }
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.setSkillDraftSuggestions'].input.parse({
        enabled: 'true'
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.setSkillDraftSuggestions'].input.parse({
        enabled: true
      })
    ).toEqual({
      enabled: true
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.refreshProviderDb'].output.parse({
        result: {
          status: 'updated',
          lastUpdated: 123,
          providersCount: 2
        }
      })
    ).toEqual({
      result: {
        status: 'updated',
        lastUpdated: 123,
        providersCount: 2
      }
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.setHooksNotifications'].input.parse({
        config: {
          hooks: [
            {
              id: 'hook-1',
              name: 'Hook 1',
              enabled: true,
              command: 'echo test',
              events: ['NotRealEvent']
            }
          ]
        }
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.setHooksNotifications'].input.parse({
        config: {
          hooks: [
            {
              id: 'hook-1',
              name: 'Hook 1',
              enabled: true,
              command: 'echo test',
              events: ['SessionStart']
            }
          ]
        }
      })
    ).toEqual({
      config: {
        hooks: [
          {
            id: 'hook-1',
            name: 'Hook 1',
            enabled: true,
            command: 'echo test',
            events: ['SessionStart']
          }
        ]
      }
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['config.setAcpAgentEnabled'].input.parse({
        agentId: 'codex-acp',
        enabled: 'true'
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['config.addManualAcpAgent'].input.parse({
        name: 'Manual ACP',
        command: 'node',
        enabled: true
      })
    ).toEqual({
      name: 'Manual ACP',
      command: 'node',
      enabled: true
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['providers.getRateLimitStatus'].input.parse({
        providerId: 'openai'
      })
    ).toEqual({
      providerId: 'openai'
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['providers.updateRateLimit'].input.parse({
        providerId: 'openai',
        enabled: true,
        qpsLimit: 2
      })
    ).toEqual({
      providerId: 'openai',
      enabled: true,
      qpsLimit: 2
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['providers.updateRateLimit'].input.parse({
        providerId: 'openai',
        enabled: true,
        qpsLimit: 0
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['providers.syncModelScopeMcpServers'].input.parse({
        providerId: 'modelscope',
        syncOptions: {
          page_number: 1,
          page_size: 50
        }
      })
    ).toEqual({
      providerId: 'modelscope',
      syncOptions: {
        page_number: 1,
        page_size: 50
      }
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['providers.runAcpDebugAction'].input.parse({
        agentId: 'codex-acp',
        action: 'initialize',
        payload: {}
      })
    ).toEqual({
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {}
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['models.getCapabilities'].output.parse({
        capabilities: {
          supportsReasoning: true,
          reasoningPortrait: null,
          thinkingBudgetRange: null,
          supportsSearch: true,
          searchDefaults: { default: true, forced: false, strategy: 'turbo' },
          supportsAudioInput: false,
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
        supportsAudioInput: false,
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
          imageGenerationModel: {
            providerId: 'openai',
            modelId: 'gpt-image-1'
          },
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
        imageGenerationModel: {
          providerId: 'openai',
          modelId: 'gpt-image-1'
        },
        systemPrompt: 'system',
        permissionMode: 'full_access',
        disabledAgentTools: ['tool-a'],
        subagentEnabled: true,
        defaultProjectPath: null
      }
    })
  })

  it('validates knowledge route contracts', () => {
    expect(
      DEEPCHAT_ROUTE_CATALOG['knowledge.listFiles'].input.parse({
        knowledgeBaseId: 'knowledge-1'
      })
    ).toEqual({
      knowledgeBaseId: 'knowledge-1'
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['knowledge.listFiles'].input.parse({
        knowledgeBaseId: ''
      })
    ).toThrow()

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['knowledge.similarityQuery'].input.parse({
        knowledgeBaseId: 'knowledge-1',
        query: ''
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['knowledge.validateFile'].output.parse({
        result: {
          isSupported: true,
          mimeType: 'text/markdown',
          adapterType: 'text'
        }
      })
    ).toEqual({
      result: {
        isSupported: true,
        mimeType: 'text/markdown',
        adapterType: 'text'
      }
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['knowledge.addFile'].output.parse({
        result: {
          data: {
            id: 'file-1',
            name: 'guide.md',
            path: '/workspace/guide.md',
            mimeType: 'text/markdown',
            status: 'completed',
            uploadedAt: 123,
            metadata: {
              size: 1024,
              totalChunks: 3
            }
          }
        }
      })
    ).toEqual({
      result: {
        data: {
          id: 'file-1',
          name: 'guide.md',
          path: '/workspace/guide.md',
          mimeType: 'text/markdown',
          status: 'completed',
          uploadedAt: 123,
          metadata: {
            size: 1024,
            totalChunks: 3
          }
        }
      }
    })
  })

  it('validates skill sync route contracts', () => {
    const source = {
      name: 'write-tests',
      description: 'Write tests',
      path: '/tools/write-tests.md',
      format: 'markdown',
      lastModified: new Date('2024-01-01T00:00:00.000Z')
    }
    const importPreview = {
      skill: {
        name: 'write-tests',
        description: 'Write tests',
        instructions: 'Write useful tests'
      },
      source,
      warnings: []
    }

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['skillSync.previewImport'].input.parse({
        toolId: '',
        skillNames: ['write-tests']
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['skillSync.previewImport'].input.parse({
        toolId: 'codex',
        skillNames: ['write-tests']
      })
    ).toEqual({
      toolId: 'codex',
      skillNames: ['write-tests']
    })

    expect(() =>
      DEEPCHAT_ROUTE_CATALOG['skillSync.executeImport'].input.parse({
        previews: [importPreview],
        strategies: {
          'write-tests': 'replace'
        }
      })
    ).toThrow()

    expect(
      DEEPCHAT_ROUTE_CATALOG['skillSync.executeImport'].input.parse({
        previews: [importPreview],
        strategies: {
          'write-tests': 'overwrite'
        }
      })
    ).toEqual({
      previews: [importPreview],
      strategies: {
        'write-tests': 'overwrite'
      }
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['skillSync.scanExternalTools'].output.parse({
        results: [
          {
            toolId: 'codex',
            toolName: 'Codex',
            available: true,
            skillsDir: '/tools',
            skills: [source]
          }
        ]
      })
    ).toEqual({
      results: [
        {
          toolId: 'codex',
          toolName: 'Codex',
          available: true,
          skillsDir: '/tools',
          skills: [source]
        }
      ]
    })

    expect(
      DEEPCHAT_ROUTE_CATALOG['skillSync.getAgentSkillDetail'].input.parse({
        agentId: 'codex',
        skillName: 'write-tests'
      })
    ).toEqual({
      agentId: 'codex',
      skillName: 'write-tests'
    })
  })

  it('registers typed event catalog entries through phase4', () => {
    const eventKeys = Object.keys(DEEPCHAT_EVENT_CATALOG).sort()

    expect(eventKeys).toEqual(
      expect.arrayContaining([
        'acpTerminal.error',
        'acpTerminal.exited',
        'acpTerminal.externalDependenciesRequired',
        'acpTerminal.output',
        'acpTerminal.started',
        'appRuntime.dataResetCompleteDev',
        'appRuntime.guidedOnboardingStartRequested',
        'appRuntime.mcpInstallRequested',
        'appRuntime.shortcutRequested',
        'appRuntime.startDeeplinkRequested',
        'appRuntime.systemNotificationClicked',
        'appRuntime.windowBlurred',
        'appRuntime.windowFocused',
        'browser.activity.changed',
        'browser.open.requested',
        'browser.status.changed',
        'chat.plan.updated',
        'chat.stream.completed',
        'chat.stream.failed',
        'chat.stream.updated',
        'contextMenu.askAiRequested',
        'contextMenu.translateRequested',
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
        'databaseSecurity.repairSuggested',
        'dialog.requested',
        'knowledge.file.progress',
        'knowledge.file.updated',
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
        'notification.error',
        'oauth.openaiCodex.statusChanged',
        'providers.acp.debug.event',
        'providers.changed',
        'providers.ollama.pull.progress',
        'providers.rateLimit.configUpdated',
        'providers.rateLimit.requestExecuted',
        'providers.rateLimit.requestQueued',
        'sessions.acp.commands.ready',
        'sessions.acp.configOptions.ready',
        'sessions.acp.modes.ready',
        'sessions.compaction.changed',
        'sessions.pendingInputs.changed',
        'sessions.status.changed',
        'sessions.updated',
        'settings.checkForUpdatesRequested',
        'settings.changed',
        'settings.navigateRequested',
        'settings.providerInstallRequested',
        'startup.workload.changed',
        'skills.catalog.changed',
        'skills.session.changed',
        'skillSync.discoveries.changed',
        'skillSync.export.completed',
        'skillSync.export.progress',
        'skillSync.export.started',
        'skillSync.import.completed',
        'skillSync.import.progress',
        'skillSync.import.started',
        'skillSync.scan.completed',
        'skillSync.scan.started',
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
        'workspace.invalidated',
        'workspace.watch.status.changed'
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

  it('validates typed context menu payloads', () => {
    expect(
      contextMenuTranslateRequestedEvent.payload.parse({
        text: 'hello',
        x: 10,
        y: 20
      })
    ).toEqual({
      text: 'hello',
      x: 10,
      y: 20
    })

    expect(
      contextMenuAskAiRequestedEvent.payload.parse({
        text: 'what is this?'
      })
    ).toEqual({
      text: 'what is this?'
    })

    expect(() =>
      contextMenuTranslateRequestedEvent.payload.parse({
        text: ''
      })
    ).toThrow()
  })

  it('validates typed app runtime payloads', () => {
    expect(
      appRuntimeStartDeeplinkRequestedEvent.payload.parse({
        msg: 'hello',
        modelId: null,
        systemPrompt: '',
        mentions: ['README.md'],
        autoSend: false
      })
    ).toEqual({
      msg: 'hello',
      modelId: null,
      systemPrompt: '',
      mentions: ['README.md'],
      autoSend: false
    })

    expect(
      appRuntimeShortcutRequestedEvent.payload.parse({
        action: 'toggleSpotlight'
      })
    ).toEqual({
      action: 'toggleSpotlight'
    })

    expect(() =>
      appRuntimeShortcutRequestedEvent.payload.parse({
        action: 'unknown'
      })
    ).toThrow()
  })

  it('validates pending provider install window route payloads', () => {
    const preview = {
      kind: 'builtin',
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      maskedApiKey: 'sk-s...cret',
      iconModelId: 'deepseek-chat',
      willOverwrite: true
    }

    expect(
      windowConsumePendingSettingsProviderInstallRoute.output.parse({
        preview
      })
    ).toEqual({
      preview
    })

    expect(
      windowRequeuePendingSettingsProviderInstallRoute.input.parse({
        preview
      })
    ).toEqual({
      preview
    })

    expect(() =>
      windowRequeuePendingSettingsProviderInstallRoute.input.parse({
        preview: {
          ...preview,
          id: ''
        }
      })
    ).toThrow()
  })
})
