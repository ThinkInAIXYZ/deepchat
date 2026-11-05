import type { DeepchatEventName } from '@shared/contracts/events'
import type { SettingsStore } from '@/config/settingsStore'
import { DesktopSettings } from '@/desktop/settings'
import { FontSettings } from '@/desktop/fontSettings'
import { PromptSettings } from '@/agent/promptSettings'
import { SkillSettings } from '@/skill/settings'
import { AgentTraceSettings } from '@/agent/traceSettings'
import { DeepChatDefaults } from '@/agent/deepchat/defaults'
import { LoggingService } from '@/app/logging'
import { OcrSettings } from '@/ocr/ocrSettings'

export interface SettingsSubsystemEffects {
  /** Re-applies the UI language to every open window. */
  refreshLanguage(): void
  /** Re-applies dark/light to the native window chrome. */
  refreshTheme(): Promise<void>
  /** Restarts the app so a persisted logging change takes effect. */
  restartApp(): void
  /** Turns the main-process log sink on or off with the setting. */
  setLogPersistenceEnabled(enabled: boolean): void
}

export interface SettingsSubsystem {
  promptSettings: PromptSettings
  desktopSettings: DesktopSettings
  fontSettings: FontSettings
  skillSettings: SkillSettings
  traceSettings: AgentTraceSettings
  agentDefaults: DeepChatDefaults
  logging: LoggingService
  ocr: OcrSettings
}

/**
 * Builds the settings services that read from the app settings store.
 *
 * Extracted from `createComposition` so the Node sidecar can build the same
 * services. Deps are explicit and the effects are callbacks, because the two
 * runtimes apply language and theme differently: Electron updates window chrome,
 * the Go shell owns it.
 */
export function createSettingsSubsystem(deps: {
  store: SettingsStore
  /**
   * Loose on purpose: the publisher in the Electron main process takes an
   * unknown payload, and typing it per event would force every caller to narrow.
   */
  publish: (name: DeepchatEventName, payload: unknown) => void
  effects: SettingsSubsystemEffects
}): SettingsSubsystem {
  const promptSettings = new PromptSettings(deps.store, {
    publishCustomPromptsChanged: (prompts) =>
      deps.publish('config.customPrompts.changed', {
        prompts,
        version: Date.now()
      }),
    publishSystemPromptsChanged: (state) =>
      deps.publish('config.systemPrompts.changed', {
        ...state,
        version: Date.now()
      })
  })

  return {
    promptSettings,
    desktopSettings: new DesktopSettings(deps.store, deps.effects, deps.publish),
    fontSettings: new FontSettings(deps.store, deps.publish),
    skillSettings: new SkillSettings(deps.store),
    traceSettings: new AgentTraceSettings(deps.store),
    agentDefaults: new DeepChatDefaults({
      settings: deps.store,
      publishSettingChanged: (key, value) =>
        deps.publish('settings.changed', {
          changedKeys: [key],
          version: Date.now(),
          values: { [key]: value }
        })
    }),
    logging: new LoggingService(
      deps.store,
      deps.effects.restartApp,
      deps.publish,
      deps.effects.setLogPersistenceEnabled
    ),
    ocr: new OcrSettings(deps.store, deps.publish)
  }
}
