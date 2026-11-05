import type { DeepchatEventName } from '@shared/contracts/events'
import type { SettingsStore } from '@/config/settingsStore'
import { DesktopSettings } from '@/desktop/settings'
import { FontSettings } from '@/desktop/fontSettings'
import { PromptSettings } from '@/agent/promptSettings'
import { SkillSettings } from '@/skill/settings'
import { AgentTraceSettings } from '@/agent/traceSettings'

export interface SettingsSubsystemEffects {
  /** Re-applies the UI language to every open window. */
  refreshLanguage(): void
  /** Re-applies dark/light to the native window chrome. */
  refreshTheme(): Promise<void>
}

export interface SettingsSubsystem {
  promptSettings: PromptSettings
  desktopSettings: DesktopSettings
  fontSettings: FontSettings
  skillSettings: SkillSettings
  traceSettings: AgentTraceSettings
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
    traceSettings: new AgentTraceSettings(deps.store)
  }
}
