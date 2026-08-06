import {
  SETTINGS_KEYS,
  configGetEntriesRoute,
  configUpdateEntriesRoute,
  settingsActivityListRoute,
  settingsGetPublicRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdatePublicRoute,
  settingsUpdateRoute,
  type ConfigEntryKey,
  type ConfigEntryValues,
  type SettingsActivityInput,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'
import type { DeepChatDefaults } from '@/agent/deepchat/defaults'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { PrivacySettingsPort } from './privacy'
import type { DesktopSettings } from '@/desktop/settings'
import type { FontSettings } from '@/desktop/fontSettings'
import type { LoggingService } from './logging'
import type { OcrSettingsPort } from '@/ocr/ocrSettings'
import type { SettingsStore } from '@/config/settingsStore'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createAppSettingsRoutes(deps: {
  settings: Pick<SettingsStore, 'get' | 'set'>
  agentDefaults: DeepChatDefaults
  privacy: PrivacySettingsPort
  traceSettings: AgentTraceSettingsPort
  desktopSettings: DesktopSettings
  fonts: FontSettings
  logging: LoggingService
  ocr: OcrSettingsPort
  applyContentProtection(enabled: boolean): void
  recordActivity(input: SettingsActivityInput): void
  listActivities(limit?: number): Promise<unknown[]>
}): DeepchatRouteMap {
  const readEntries = (keys?: ConfigEntryKey[]): Partial<ConfigEntryValues> => {
    const selectedKeys = keys?.length ? keys : undefined
    const values: Partial<ConfigEntryValues> = {}
    const read = <K extends ConfigEntryKey>(key: K): void => {
      if (selectedKeys && !selectedKeys.includes(key)) return
      const value = deps.settings.get<ConfigEntryValues[K]>(key)
      if (value !== undefined) values[key] = value
    }
    read('init_complete')
    read('assistantModel')
    read('preferredModel')
    read('defaultModel')
    read('default_system_prompt')
    read('maxFileSize')
    read('input_deepThinking')
    read('input_chatMode')
    read('think_collapse')
    read('artifact_think_collapse')
    read('providerOrder')
    read('providerTimestamps')
    read('sidebar_group_mode')
    read('input_enabledMcpTools')
    return values
  }
  const readSnapshot = (): SettingsSnapshotValues => ({
    fontSizeLevel: deps.desktopSettings.getFontSizeLevel(),
    fontFamily: deps.fonts.getFontFamily(),
    codeFontFamily: deps.fonts.getCodeFontFamily(),
    artifactsEffectEnabled: deps.desktopSettings.getArtifactsEffectEnabled(),
    autoScrollEnabled: deps.desktopSettings.getAutoScrollEnabled(),
    autoCompactionEnabled: deps.agentDefaults.getAutoCompactionEnabled(),
    autoCompactionTriggerThreshold: deps.agentDefaults.getAutoCompactionTriggerThreshold(),
    autoCompactionRetainRecentPairs: deps.agentDefaults.getAutoCompactionRetainRecentPairs(),
    contentProtectionEnabled: deps.desktopSettings.getContentProtectionEnabled(),
    privacyModeEnabled: deps.privacy.isEnabled(),
    notificationsEnabled: deps.desktopSettings.getNotificationsEnabled(),
    launchAtLoginEnabled: deps.desktopSettings.getLaunchAtLoginEnabled(),
    traceDebugEnabled: deps.traceSettings.isEnabled(),
    copyWithCotEnabled: deps.desktopSettings.getCopyWithCotEnabled(),
    loggingEnabled: deps.logging.getEnabled(),
    ocrAutoExtractForNonVisionModels: deps.ocr.getAutomaticExtractionEnabled(),
    ocrBackend: deps.ocr.getBackend()
  })
  const pickSnapshot = (
    snapshot: SettingsSnapshotValues,
    keys?: SettingsKey[]
  ): Partial<SettingsSnapshotValues> => {
    const result: Partial<SettingsSnapshotValues> = {}
    for (const key of keys?.length ? keys : SETTINGS_KEYS) {
      ;(result as Record<SettingsKey, SettingsSnapshotValues[SettingsKey]>)[key] = snapshot[key]
    }
    return result
  }
  const applyChange = (change: SettingsChange): void => {
    switch (change.key) {
      case 'fontSizeLevel':
        deps.desktopSettings.setFontSizeLevel(change.value)
        return
      case 'fontFamily':
        deps.fonts.setFontFamily(change.value)
        return
      case 'codeFontFamily':
        deps.fonts.setCodeFontFamily(change.value)
        return
      case 'artifactsEffectEnabled':
        deps.desktopSettings.setArtifactsEffectEnabled(change.value)
        return
      case 'autoScrollEnabled':
        deps.desktopSettings.setAutoScrollEnabled(change.value)
        return
      case 'autoCompactionEnabled':
        deps.agentDefaults.setAutoCompactionEnabled(change.value)
        return
      case 'autoCompactionTriggerThreshold':
        deps.agentDefaults.setAutoCompactionTriggerThreshold(change.value)
        return
      case 'autoCompactionRetainRecentPairs':
        deps.agentDefaults.setAutoCompactionRetainRecentPairs(change.value)
        return
      case 'contentProtectionEnabled':
        deps.desktopSettings.setContentProtectionEnabled(change.value)
        deps.applyContentProtection(change.value)
        return
      case 'privacyModeEnabled':
        deps.privacy.setEnabled(change.value)
        return
      case 'notificationsEnabled':
        deps.desktopSettings.setNotificationsEnabled(change.value)
        return
      case 'launchAtLoginEnabled':
        deps.desktopSettings.setLaunchAtLoginEnabled(change.value)
        return
      case 'traceDebugEnabled':
        deps.traceSettings.setEnabled(change.value)
        return
      case 'copyWithCotEnabled':
        deps.desktopSettings.setCopyWithCotEnabled(change.value)
        return
      case 'loggingEnabled':
        deps.logging.setEnabled(change.value)
        return
      case 'ocrAutoExtractForNonVisionModels':
        deps.ocr.setAutomaticExtractionEnabled(change.value)
        return
      case 'ocrBackend':
        deps.ocr.setBackend(change.value)
    }
  }
  const recordChange = (change: SettingsChange): void => {
    deps.recordActivity({
      category:
        change.key === 'privacyModeEnabled'
          ? 'privacy'
          : change.key === 'fontSizeLevel' ||
              change.key === 'fontFamily' ||
              change.key === 'codeFontFamily' ||
              change.key === 'artifactsEffectEnabled' ||
              change.key === 'contentProtectionEnabled'
            ? 'appearance'
            : 'system',
      action:
        typeof change.value === 'boolean' ? (change.value ? 'enabled' : 'disabled') : 'updated',
      targetType: 'setting',
      targetId: change.key,
      targetLabel: change.key,
      routeName:
        change.key === 'privacyModeEnabled'
          ? 'settings-database'
          : change.key === 'ocrAutoExtractForNonVisionModels' || change.key === 'ocrBackend'
            ? 'settings-ocr'
            : 'settings-common',
      summaryKey: 'settings.controlCenter.activity.settingUpdated',
      summaryParams: { key: change.key }
    })
  }
  const getSnapshot = (keys?: SettingsKey[]) => ({
    version: Date.now(),
    values: pickSnapshot(readSnapshot(), keys)
  })
  const updateSnapshot = (changes: SettingsChange[]) => {
    for (const change of changes) {
      applyChange(change)
      recordChange(change)
    }
    const changedKeys = changes.map((change) => change.key)
    return {
      version: Date.now(),
      changedKeys,
      values: pickSnapshot(readSnapshot(), changedKeys)
    }
  }

  return createRouteMap([
    [
      configGetEntriesRoute.name,
      async (rawInput) => {
        const input = configGetEntriesRoute.input.parse(rawInput)
        return configGetEntriesRoute.output.parse({
          version: Date.now(),
          values: readEntries(input.keys)
        })
      }
    ],
    [
      configUpdateEntriesRoute.name,
      async (rawInput) => {
        const input = configUpdateEntriesRoute.input.parse(rawInput)
        for (const change of input.changes) deps.settings.set(change.key, change.value)
        return configUpdateEntriesRoute.output.parse({
          version: Date.now(),
          changedKeys: input.changes.map((change) => change.key),
          values: readEntries(input.changes.map((change) => change.key))
        })
      }
    ],
    [
      settingsGetSnapshotRoute.name,
      async (rawInput) => {
        const input = settingsGetSnapshotRoute.input.parse(rawInput)
        return settingsGetSnapshotRoute.output.parse(getSnapshot(input.keys))
      }
    ],
    [
      settingsGetPublicRoute.name,
      async (rawInput) => {
        const input = settingsGetPublicRoute.input.parse(rawInput)
        return settingsGetPublicRoute.output.parse(getSnapshot(input.keys))
      }
    ],
    [
      settingsListSystemFontsRoute.name,
      async (rawInput) => {
        settingsListSystemFontsRoute.input.parse(rawInput)
        return settingsListSystemFontsRoute.output.parse({
          fonts: await deps.fonts.getSystemFonts()
        })
      }
    ],
    [
      settingsUpdateRoute.name,
      async (rawInput) => {
        const input = settingsUpdateRoute.input.parse(rawInput)
        return settingsUpdateRoute.output.parse(updateSnapshot(input.changes))
      }
    ],
    [
      settingsUpdatePublicRoute.name,
      async (rawInput) => {
        const input = settingsUpdatePublicRoute.input.parse(rawInput)
        return settingsUpdatePublicRoute.output.parse(updateSnapshot(input.changes))
      }
    ],
    [
      settingsActivityListRoute.name,
      async (rawInput) => {
        const input = settingsActivityListRoute.input.parse(rawInput)
        return settingsActivityListRoute.output.parse({
          activities: await deps.listActivities(input.limit)
        })
      }
    ]
  ])
}
