import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS, FLOATING_BUTTON_EVENTS, PROVIDER_DB_EVENTS, SYSTEM_EVENTS } from '@/events'
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
