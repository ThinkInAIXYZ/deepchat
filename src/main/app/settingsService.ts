import {
  SETTINGS_KEYS,
  settingsGetSnapshotRoute,
  settingsUpdateRoute,
  type DeepchatRouteOutput,
  type SettingsActivityInput,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'
import {
  ChatSettingMutationSchema,
  type ApplyChatSettingSuccess,
  type ChatSettingMutation
} from '@shared/types/chatSettings'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { DeepChatDefaults } from '@/agent/deepchat/defaults'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { PrivacySettingsPort } from './privacy'
import type { DesktopSettings } from '@/desktop/settings'
import type { FontSettings } from '@/desktop/fontSettings'
import type { LoggingService } from './logging'
import type { OcrSettingsPort } from '@/ocr/ocrSettings'

export interface AppSettingsServiceDependencies {
  agentDefaults: DeepChatDefaults
  privacy: PrivacySettingsPort
  traceSettings: AgentTraceSettingsPort
  desktopSettings: DesktopSettings
  fonts: FontSettings
  logging: LoggingService
  ocr: OcrSettingsPort
  applyContentProtection(enabled: boolean): void
  recordActivity(input: SettingsActivityInput): void
  publishEvent: DeepchatEventPublisher
  nextVersion(): number
  assertActive(): void
}

export class AppSettingsService {
  constructor(private readonly deps: AppSettingsServiceDependencies) {}

  private readonly readSnapshot = (): SettingsSnapshotValues => ({
    fontSizeLevel: this.deps.desktopSettings.getFontSizeLevel(),
    fontFamily: this.deps.fonts.getFontFamily(),
    codeFontFamily: this.deps.fonts.getCodeFontFamily(),
    autoScrollEnabled: this.deps.desktopSettings.getAutoScrollEnabled(),
    autoCompactionEnabled: this.deps.agentDefaults.getAutoCompactionEnabled(),
    autoCompactionTriggerThreshold: this.deps.agentDefaults.getAutoCompactionTriggerThreshold(),
    autoCompactionRetainRecentPairs: this.deps.agentDefaults.getAutoCompactionRetainRecentPairs(),
    contentProtectionEnabled: this.deps.desktopSettings.getContentProtectionEnabled(),
    privacyModeEnabled: this.deps.privacy.isEnabled(),
    notificationsEnabled: this.deps.desktopSettings.getNotificationsEnabled(),
    launchAtLoginEnabled: this.deps.desktopSettings.getLaunchAtLoginEnabled(),
    traceDebugEnabled: this.deps.traceSettings.isEnabled(),
    copyWithCotEnabled: this.deps.desktopSettings.getCopyWithCotEnabled(),
    loggingEnabled: this.deps.logging.getEnabled(),
    ocrAutoExtractForNonVisionModels: this.deps.ocr.getAutomaticExtractionEnabled(),
    ocrBackend: this.deps.ocr.getBackend()
  })
  private readonly pickSnapshot = (
    snapshot: SettingsSnapshotValues,
    keys?: SettingsKey[]
  ): Partial<SettingsSnapshotValues> => {
    const result: Partial<SettingsSnapshotValues> = {}
    for (const key of keys?.length ? keys : SETTINGS_KEYS) {
      ;(result as Record<SettingsKey, SettingsSnapshotValues[SettingsKey]>)[key] = snapshot[key]
    }
    return result
  }
  private readonly applyChange = (change: SettingsChange): void => {
    switch (change.key) {
      case 'fontSizeLevel':
        this.deps.desktopSettings.setFontSizeLevel(change.value)
        return
      case 'fontFamily':
        this.deps.fonts.setFontFamily(change.value)
        return
      case 'codeFontFamily':
        this.deps.fonts.setCodeFontFamily(change.value)
        return
      case 'autoScrollEnabled':
        this.deps.desktopSettings.setAutoScrollEnabled(change.value)
        return
      case 'autoCompactionEnabled':
        this.deps.agentDefaults.setAutoCompactionEnabled(change.value)
        return
      case 'autoCompactionTriggerThreshold':
        this.deps.agentDefaults.setAutoCompactionTriggerThreshold(change.value)
        return
      case 'autoCompactionRetainRecentPairs':
        this.deps.agentDefaults.setAutoCompactionRetainRecentPairs(change.value)
        return
      case 'contentProtectionEnabled':
        this.deps.desktopSettings.setContentProtectionEnabled(change.value)
        this.deps.applyContentProtection(change.value)
        return
      case 'privacyModeEnabled':
        this.deps.privacy.setEnabled(change.value)
        return
      case 'notificationsEnabled':
        this.deps.desktopSettings.setNotificationsEnabled(change.value)
        return
      case 'launchAtLoginEnabled':
        this.deps.desktopSettings.setLaunchAtLoginEnabled(change.value)
        return
      case 'traceDebugEnabled':
        this.deps.traceSettings.setEnabled(change.value)
        return
      case 'copyWithCotEnabled':
        this.deps.desktopSettings.setCopyWithCotEnabled(change.value)
        return
      case 'loggingEnabled':
        this.deps.logging.setEnabled(change.value)
        return
      case 'ocrAutoExtractForNonVisionModels':
        this.deps.ocr.setAutomaticExtractionEnabled(change.value)
        return
      case 'ocrBackend':
        this.deps.ocr.setBackend(change.value)
    }
  }
  private readonly recordChange = (change: SettingsChange): void => {
    this.deps.recordActivity({
      category:
        change.key === 'privacyModeEnabled'
          ? 'privacy'
          : change.key === 'fontSizeLevel' ||
              change.key === 'fontFamily' ||
              change.key === 'codeFontFamily' ||
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

  async getSnapshot(keys?: SettingsKey[]): Promise<DeepchatRouteOutput<'settings.getSnapshot'>> {
    const input = settingsGetSnapshotRoute.input.parse({ keys })
    this.deps.assertActive()
    const version = this.deps.nextVersion()
    return { version, values: this.pickSnapshot(this.readSnapshot(), input.keys) }
  }

  async update(changes: SettingsChange[]): Promise<DeepchatRouteOutput<'settings.update'>> {
    const input = settingsUpdateRoute.input.parse({ changes })
    this.deps.assertActive()
    for (const change of input.changes) {
      this.applyChange(change)
      this.recordChange(change)
    }
    const changedKeys = input.changes.map((change) => change.key)
    return {
      version: this.deps.nextVersion(),
      changedKeys,
      values: this.pickSnapshot(this.readSnapshot(), changedKeys)
    }
  }

  publishSnapshot(): void {
    this.deps.assertActive()
    this.deps.publishEvent('settings.changed', {
      version: this.deps.nextVersion(),
      changedKeys: [...SETTINGS_KEYS],
      values: this.readSnapshot()
    })
  }

  async applyDisplayChange(raw: ChatSettingMutation): Promise<ApplyChatSettingSuccess> {
    const change = ChatSettingMutationSchema.parse(raw)
    this.deps.assertActive()
    const settings = this.deps.desktopSettings
    let previousValue: ApplyChatSettingSuccess['previousValue']
    switch (change.id) {
      case 'copyWithCotEnabled':
        previousValue = settings.getCopyWithCotEnabled()
        settings.setCopyWithCotEnabled(change.value)
        break
      case 'fontSizeLevel':
        previousValue = settings.getFontSizeLevel()
        settings.setFontSizeLevel(change.value)
        break
      case 'language':
        previousValue = settings.getRequestedLanguage()
        settings.setLanguage(change.value)
        break
      case 'theme':
        previousValue = settings.getTheme()
        settings.setTheme(change.value)
        break
    }
    return { ok: true, id: change.id, value: change.value, previousValue, appliedAt: Date.now() }
  }
}
