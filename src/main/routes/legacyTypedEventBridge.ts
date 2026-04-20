import { BrowserWindow } from 'electron'
import { eventBus } from '@/eventbus'
import {
  CONFIG_EVENTS,
  FLOATING_BUTTON_EVENTS,
  MCP_EVENTS,
  PROVIDER_DB_EVENTS,
  SYNC_EVENTS,
  SYSTEM_EVENTS,
  WINDOW_EVENTS
} from '@/events'
import { publishDeepchatEvent } from './publishDeepchatEvent'
import type { IConfigPresenter, ILlmProviderPresenter, ShortcutKeySetting } from '@shared/presenter'
import {
  readAcpState,
  readLanguageState,
  readSyncSettings,
  readSystemPromptState,
  readThemeState
} from './config/configRouteSupport'

let legacyTypedEventBridgeInitialized = false

export function setupLegacyTypedEventBridge(deps: {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
}): void {
  if (legacyTypedEventBridgeInitialized) {
    return
  }

  legacyTypedEventBridgeInitialized = true
  const { configPresenter } = deps

  const publishLanguageChanged = () => {
    publishDeepchatEvent('config.language.changed', {
      ...readLanguageState(configPresenter),
      version: Date.now()
    })
  }

  const publishThemeChanged = async () => {
    publishDeepchatEvent('config.theme.changed', {
      ...(await readThemeState(configPresenter)),
      version: Date.now()
    })
  }

  const publishSyncSettingsChanged = () => {
    publishDeepchatEvent('config.syncSettings.changed', {
      ...readSyncSettings(configPresenter),
      version: Date.now()
    })
  }

  const publishAgentsChanged = async () => {
    const state = await readAcpState(configPresenter)
    publishDeepchatEvent('config.agents.changed', {
      ...state,
      version: Date.now()
    })
  }

  const publishCustomPromptsChanged = async () => {
    publishDeepchatEvent('config.customPrompts.changed', {
      prompts: await configPresenter.getCustomPrompts(),
      version: Date.now()
    })
  }

  const publishMcpConfigChanged = async () => {
    publishDeepchatEvent('mcp.config.changed', {
      mcpServers: await configPresenter.getMcpServers(),
      mcpEnabled: await configPresenter.getMcpEnabled(),
      version: Date.now()
    })
  }

  const resolveWindowId = (payload: unknown): number | null => {
    if (typeof payload === 'number') {
      return payload
    }

    if (
      payload &&
      typeof payload === 'object' &&
      'windowId' in payload &&
      typeof (payload as { windowId?: unknown }).windowId === 'number'
    ) {
      return (payload as { windowId: number }).windowId
    }

    return null
  }

  const publishWindowStateChanged = (payload: unknown, existsOverride?: boolean) => {
    const windowId = resolveWindowId(payload)
    const window = windowId != null ? BrowserWindow.fromId(windowId) : null
    const exists = existsOverride ?? Boolean(window && !window.isDestroyed())

    publishDeepchatEvent('window.state.changed', {
      windowId,
      exists,
      isMaximized: exists ? window!.isMaximized() : false,
      isFullScreen: exists ? window!.isFullScreen() : false,
      isFocused: exists ? window!.isFocused() : false,
      version: Date.now()
    })
  }

  eventBus.on(CONFIG_EVENTS.LANGUAGE_CHANGED, () => {
    publishLanguageChanged()
  })

  eventBus.on(CONFIG_EVENTS.THEME_CHANGED, () => {
    void publishThemeChanged()
  })

  eventBus.on(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, (isDark: boolean) => {
    publishDeepchatEvent('config.systemTheme.changed', {
      isDark,
      version: Date.now()
    })
  })

  eventBus.on(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, (enabled: boolean) => {
    publishDeepchatEvent('config.floatingButton.changed', {
      enabled: Boolean(enabled),
      version: Date.now()
    })
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_CREATED, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_FOCUSED, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_BLURRED, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_MAXIMIZED, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, (payload?: unknown) => {
    publishWindowStateChanged(payload)
  })

  eventBus.on(WINDOW_EVENTS.WINDOW_CLOSED, (payload?: unknown) => {
    publishWindowStateChanged(payload, false)
  })

  eventBus.on(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, () => {
    publishSyncSettingsChanged()
  })

  eventBus.on(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, (payload?: { path?: string | null }) => {
    publishDeepchatEvent('config.defaultProjectPath.changed', {
      path: payload?.path ?? configPresenter.getDefaultProjectPath(),
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.AGENTS_CHANGED, () => {
    void publishAgentsChanged()
    publishDeepchatEvent('models.changed', {
      reason: 'agents',
      providerId: 'acp',
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.CUSTOM_PROMPTS_CHANGED, () => {
    void publishCustomPromptsChanged()
  })

  eventBus.on(MCP_EVENTS.SERVER_STARTED, (serverName?: string) => {
    if (!serverName) {
      return
    }

    publishDeepchatEvent('mcp.server.started', {
      serverName,
      version: Date.now()
    })
  })

  eventBus.on(MCP_EVENTS.SERVER_STOPPED, (serverName?: string) => {
    if (!serverName) {
      return
    }

    publishDeepchatEvent('mcp.server.stopped', {
      serverName,
      version: Date.now()
    })
  })

  eventBus.on(MCP_EVENTS.CONFIG_CHANGED, () => {
    void publishMcpConfigChanged()
  })

  eventBus.on(
    MCP_EVENTS.SERVER_STATUS_CHANGED,
    (payload?: { name?: string; serverName?: string; status?: string; isRunning?: boolean }) => {
      const serverName = payload?.serverName ?? payload?.name
      if (!serverName) {
        return
      }

      const isRunning =
        typeof payload?.isRunning === 'boolean' ? payload.isRunning : payload?.status === 'running'

      publishDeepchatEvent('mcp.server.status.changed', {
        serverName,
        isRunning,
        version: Date.now()
      })
    }
  )

  eventBus.on(
    MCP_EVENTS.TOOL_CALL_RESULT,
    (payload?: { function_name?: string; functionName?: string; content?: unknown }) => {
      if (!payload || payload.content === undefined) {
        return
      }

      publishDeepchatEvent('mcp.toolCall.result', {
        functionName: payload.functionName ?? payload.function_name,
        content: payload.content,
        version: Date.now()
      })
    }
  )

  eventBus.on(SYNC_EVENTS.BACKUP_STARTED, () => {
    publishDeepchatEvent('sync.backup.started', {
      version: Date.now()
    })
  })

  eventBus.on(SYNC_EVENTS.BACKUP_COMPLETED, (timestamp?: number) => {
    publishDeepchatEvent('sync.backup.completed', {
      timestamp: timestamp ?? Date.now(),
      version: Date.now()
    })
  })

  eventBus.on(SYNC_EVENTS.BACKUP_ERROR, (error?: string) => {
    publishDeepchatEvent('sync.backup.error', {
      error,
      version: Date.now()
    })
  })

  eventBus.on(
    SYNC_EVENTS.BACKUP_STATUS_CHANGED,
    (payload?: {
      status?: string
      previousStatus?: string
      lastSuccessfulBackupTime?: number
      failed?: boolean
      message?: string
    }) => {
      if (!payload?.status) {
        return
      }

      publishDeepchatEvent('sync.backup.status.changed', {
        status: payload.status,
        previousStatus: payload.previousStatus,
        lastSuccessfulBackupTime: payload.lastSuccessfulBackupTime,
        failed: payload.failed,
        message: payload.message,
        version: Date.now()
      })
    }
  )

  eventBus.on(SYNC_EVENTS.IMPORT_STARTED, () => {
    publishDeepchatEvent('sync.import.started', {
      version: Date.now()
    })
  })

  eventBus.on(SYNC_EVENTS.IMPORT_COMPLETED, () => {
    publishDeepchatEvent('sync.import.completed', {
      version: Date.now()
    })
  })

  eventBus.on(SYNC_EVENTS.IMPORT_ERROR, (error?: string) => {
    publishDeepchatEvent('sync.import.error', {
      error,
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.PROVIDER_CHANGED, () => {
    publishDeepchatEvent('providers.changed', {
      reason: 'providers',
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, (change?: { providerId?: string }) => {
    publishDeepchatEvent('providers.changed', {
      reason: 'provider-atomic-update',
      providerIds: change?.providerId ? [change.providerId] : undefined,
      version: Date.now()
    })
  })

  eventBus.on(
    CONFIG_EVENTS.PROVIDER_BATCH_UPDATE,
    (payload?: { providers?: Array<{ id: string }> }) => {
      publishDeepchatEvent('providers.changed', {
        reason: 'provider-batch-update',
        providerIds: Array.isArray(payload?.providers)
          ? payload.providers.map((provider) => provider.id)
          : undefined,
        version: Date.now()
      })
    }
  )

  eventBus.on(PROVIDER_DB_EVENTS.LOADED, () => {
    publishDeepchatEvent('providers.changed', {
      reason: 'provider-db-loaded',
      version: Date.now()
    })
    publishDeepchatEvent('models.changed', {
      reason: 'provider-db-loaded',
      version: Date.now()
    })
  })

  eventBus.on(PROVIDER_DB_EVENTS.UPDATED, () => {
    publishDeepchatEvent('providers.changed', {
      reason: 'provider-db-updated',
      version: Date.now()
    })
    publishDeepchatEvent('models.changed', {
      reason: 'provider-db-updated',
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, (providerId?: string) => {
    publishDeepchatEvent('models.changed', {
      reason: 'runtime-refresh',
      providerId,
      version: Date.now()
    })
  })

  eventBus.on(
    CONFIG_EVENTS.MODEL_STATUS_CHANGED,
    (payload?: { providerId?: string; modelId?: string; enabled?: boolean }) => {
      if (!payload?.providerId || !payload?.modelId) {
        return
      }

      publishDeepchatEvent('models.status.changed', {
        providerId: payload.providerId,
        modelId: payload.modelId,
        enabled: Boolean(payload.enabled),
        version: Date.now()
      })
    }
  )

  eventBus.on(
    CONFIG_EVENTS.MODEL_CONFIG_CHANGED,
    (providerId?: string, modelId?: string, config?: Record<string, unknown>) => {
      publishDeepchatEvent('models.config.changed', {
        changeType: 'updated',
        providerId,
        modelId,
        config,
        version: Date.now()
      })
    }
  )

  eventBus.on(CONFIG_EVENTS.MODEL_CONFIG_RESET, (providerId?: string, modelId?: string) => {
    publishDeepchatEvent('models.config.changed', {
      changeType: 'reset',
      providerId,
      modelId,
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.MODEL_CONFIGS_IMPORTED, (overwrite?: boolean) => {
    publishDeepchatEvent('models.config.changed', {
      changeType: 'imported',
      overwrite: Boolean(overwrite),
      version: Date.now()
    })
  })

  eventBus.on(CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED, () => {
    void readSystemPromptState(configPresenter).then((state) => {
      publishDeepchatEvent('config.systemPrompts.changed', {
        ...state,
        version: Date.now()
      })
    })
  })

  const publishShortcutKeysChanged = (shortcuts: ShortcutKeySetting) => {
    publishDeepchatEvent('config.shortcutKeys.changed', {
      shortcuts,
      version: Date.now()
    })
  }

  const originalSetShortcutKey = configPresenter.setShortcutKey.bind(configPresenter)
  configPresenter.setShortcutKey = ((shortcuts: ShortcutKeySetting) => {
    originalSetShortcutKey(shortcuts)
    publishShortcutKeysChanged(configPresenter.getShortcutKey())
  }) as typeof configPresenter.setShortcutKey

  const originalResetShortcutKeys = configPresenter.resetShortcutKeys.bind(configPresenter)
  configPresenter.resetShortcutKeys = (() => {
    originalResetShortcutKeys()
    publishShortcutKeysChanged(configPresenter.getShortcutKey())
  }) as typeof configPresenter.resetShortcutKeys
}
