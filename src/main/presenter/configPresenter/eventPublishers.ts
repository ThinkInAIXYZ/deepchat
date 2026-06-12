import { eventBus } from '@/eventbus'
import { CONFIG_EVENTS, FLOATING_BUTTON_EVENTS, SYSTEM_EVENTS } from '@/events'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import {
  readAcpState,
  readLanguageState,
  readSyncSettings,
  readThemeState
} from '@/routes/config/configRouteSupport'
import type { IConfigPresenter } from '@shared/presenter'
import type { ProviderBatchUpdate, ProviderChange } from '@shared/provider-operations'

export function emitLanguageChanged(configPresenter: IConfigPresenter, language: string): void {
  eventBus.sendToMain(CONFIG_EVENTS.LANGUAGE_CHANGED, language)
  publishDeepchatEvent('config.language.changed', {
    ...readLanguageState(configPresenter),
    version: Date.now()
  })
}

export function emitThemeChanged(
  configPresenter: IConfigPresenter,
  theme: 'dark' | 'light' | 'system'
): void {
  eventBus.sendToMain(CONFIG_EVENTS.THEME_CHANGED, theme)
  void readThemeState(configPresenter)
    .then((state) => {
      publishDeepchatEvent('config.theme.changed', {
        ...state,
        version: Date.now()
      })
    })
    .catch((error) => {
      console.error('Failed to publish typed theme changed event:', error)
    })
}

export function emitSystemThemeChanged(isDark: boolean): void {
  eventBus.sendToMain(SYSTEM_EVENTS.SYSTEM_THEME_UPDATED, isDark)
  publishDeepchatEvent('config.systemTheme.changed', {
    isDark,
    version: Date.now()
  })
}

export function emitFloatingButtonChanged(enabled: boolean): void {
  eventBus.sendToMain(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, enabled)
  publishDeepchatEvent('config.floatingButton.changed', {
    enabled,
    version: Date.now()
  })
}

export function emitSyncSettingsChanged(
  configPresenter: IConfigPresenter,
  change: { enabled?: boolean; folderPath?: string }
): void {
  eventBus.sendToMain(CONFIG_EVENTS.SYNC_SETTINGS_CHANGED, change)
  publishDeepchatEvent('config.syncSettings.changed', {
    ...readSyncSettings(configPresenter),
    version: Date.now()
  })
}

export function emitDefaultProjectPathChanged(path: string | null): void {
  eventBus.sendToMain(CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED, { path })
  publishDeepchatEvent('config.defaultProjectPath.changed', {
    path,
    version: Date.now()
  })
}

export function emitAcpAgentsChanged(configPresenter: IConfigPresenter, agentIds?: string[]): void {
  eventBus.sendToMain(CONFIG_EVENTS.AGENTS_CHANGED, { agentIds })
  void readAcpState(configPresenter)
    .then((state) => {
      publishDeepchatEvent('config.agents.changed', {
        ...state,
        agentIds,
        version: Date.now()
      })
    })
    .catch((error) => {
      console.error('Failed to publish typed ACP agents changed event:', error)
    })
  publishDeepchatEvent('models.changed', {
    reason: 'agents',
    providerId: 'acp',
    version: Date.now()
  })
}

export async function emitCustomPromptsChanged(configPresenter: IConfigPresenter): Promise<void> {
  eventBus.sendToMain(CONFIG_EVENTS.CUSTOM_PROMPTS_CHANGED)
  publishDeepchatEvent('config.customPrompts.changed', {
    prompts: await configPresenter.getCustomPrompts(),
    version: Date.now()
  })
}

export function emitProvidersChanged(): void {
  eventBus.sendToMain(CONFIG_EVENTS.PROVIDER_CHANGED)
  publishDeepchatEvent('providers.changed', {
    reason: 'providers',
    version: Date.now()
  })
}

export function emitProviderAtomicUpdate(change: ProviderChange): void {
  eventBus.sendToMain(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, change)
  publishDeepchatEvent('providers.changed', {
    reason: 'provider-atomic-update',
    providerIds: change.providerId ? [change.providerId] : undefined,
    version: Date.now()
  })
}

export function emitProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void {
  eventBus.sendToMain(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, batchUpdate)
  publishDeepchatEvent('providers.changed', {
    reason: 'provider-batch-update',
    providerIds: Array.isArray(batchUpdate.providers)
      ? batchUpdate.providers.map((provider) => provider.id)
      : undefined,
    version: Date.now()
  })
}

export function emitModelsChanged(providerId?: string): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_LIST_CHANGED, providerId)
  publishDeepchatEvent('models.changed', {
    reason: 'runtime-refresh',
    providerId,
    version: Date.now()
  })
}

export function emitModelStatusChanged(payload: {
  providerId: string
  modelId: string
  enabled: boolean
}): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_STATUS_CHANGED, payload)
  publishDeepchatEvent('models.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelBatchStatusChanged(payload: {
  providerId: string
  updates: { modelId: string; enabled: boolean }[]
}): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_BATCH_STATUS_CHANGED, payload)
  publishDeepchatEvent('models.batch.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelConfigChanged(
  providerId: string,
  modelId: string,
  config: Record<string, unknown>
): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_CONFIG_CHANGED, providerId, modelId, config)
  publishDeepchatEvent('models.config.changed', {
    changeType: 'updated',
    providerId,
    modelId,
    config,
    version: Date.now()
  })
}

export function emitModelConfigReset(providerId: string, modelId: string): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_CONFIG_RESET, providerId, modelId)
  publishDeepchatEvent('models.config.changed', {
    changeType: 'reset',
    providerId,
    modelId,
    version: Date.now()
  })
}

export function emitModelConfigsImported(overwrite: boolean): void {
  eventBus.sendToMain(CONFIG_EVENTS.MODEL_CONFIGS_IMPORTED, overwrite)
  publishDeepchatEvent('models.config.changed', {
    changeType: 'imported',
    overwrite,
    version: Date.now()
  })
}

export function emitDefaultSystemPromptChanged(payload: {
  promptId: string
  content: string
}): void {
  eventBus.sendToMain(CONFIG_EVENTS.DEFAULT_SYSTEM_PROMPT_CHANGED, payload)
}
