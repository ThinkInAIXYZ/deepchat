import {
  SETTINGS_KEYS,
  configSetLanguageRoute,
  configSetThemeRoute,
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
import { getLocaleDirection } from '@shared/locales'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import type { FloatingButtonBounds } from '@shared/types/floating-widget'
import type { ShortcutKeySetting } from '@shared/types/desktop'
import type { UpdateSettings } from '@/upgrade/settings'
import { defaultShortcutKey } from '@/desktop/shortcutKeySettings'

export interface AppSettingsServiceDependencies {
  agentDefaults: DeepChatDefaults
  privacy: PrivacySettingsPort
  traceSettings: AgentTraceSettingsPort
  desktopSettings: DesktopSettings
  fonts: FontSettings
  logging: LoggingService
  ocr: OcrSettingsPort
  recordActivity(input: SettingsActivityInput): void
  publishEvent: DeepchatEventPublisher
  nextVersion(): number
  assertActive(): void
  ownerId: string
  updateSettings: UpdateSettings
  publishNativeSnapshot(snapshot: NativeConfigurationSnapshot): void
}

export class AppSettingsService {
  private accepting = true
  private pendingCommands = 0
  private tail: Promise<void> = Promise.resolve()
  private systemThemeObservation: Promise<void> | undefined
  private nativeVersion = 0

  constructor(private readonly deps: AppSettingsServiceDependencies) {}

  private async enqueue<T>(run: () => T | Promise<T>, systemObservation = false): Promise<T> {
    this.deps.assertActive()
    if (!this.accepting) throw new Error('Settings owner is stopped')
    if (this.pendingCommands >= 64 && !systemObservation)
      throw new Error('Settings command queue is full')
    this.pendingCommands++
    const result = this.tail
      .then(() => {
        this.deps.assertActive()
        if (!this.accepting) throw new Error('Settings owner is stopped')
        return run()
      })
      .finally(() => this.pendingCommands--)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return await result
  }

  async stop(): Promise<void> {
    this.accepting = false
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.tail,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Settings owner did not drain (30000ms)')),
            30_000
          )
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  start(): void {
    if (this.pendingCommands > 0) throw new Error('Settings owner is still draining')
    this.accepting = true
  }

  readNativeSnapshot(): NativeConfigurationSnapshot {
    const settings = this.deps.desktopSettings
    const shortcuts = settings.getShortcutKeys()
    const bounds = settings.getFloatingButtonBounds()
    return structuredClone({
      ownerId: this.deps.ownerId,
      version: ++this.nativeVersion,
      language: settings.getLanguage(),
      notificationsEnabled: settings.getNotificationsEnabled(),
      closeToQuit: settings.getCloseToQuit(),
      contentProtectionEnabled: settings.getContentProtectionEnabled(),
      shortcutKeys: Object.fromEntries(
        Object.keys(defaultShortcutKey).map((key) => [
          key,
          shortcuts[key as keyof ShortcutKeySetting]
        ])
      ) as ShortcutKeySetting,
      floatingButtonEnabled: settings.getFloatingButtonEnabled(),
      floatingButtonBounds: bounds ? { x: bounds.x, y: bounds.y, dockSide: bounds.dockSide } : null,
      loggingEnabled: this.deps.logging.getEnabled(),
      privacyModeEnabled: this.deps.privacy.isEnabled(),
      updateChannel: this.deps.updateSettings.getChannel()
    })
  }

  publishNativeSnapshot(): void {
    this.deps.publishNativeSnapshot(this.readNativeSnapshot())
  }

  async getFloatingButtonEnabled(): Promise<boolean> {
    return await this.enqueue(() => this.deps.desktopSettings.getFloatingButtonEnabled())
  }

  async setFloatingButtonEnabled(enabled: boolean): Promise<boolean> {
    return await this.enqueue(async () => {
      await this.deps.desktopSettings.setFloatingButtonEnabled(enabled)
      return this.deps.desktopSettings.getFloatingButtonEnabled()
    })
  }

  async setFloatingButtonBounds(bounds: FloatingButtonBounds): Promise<void> {
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !['left', 'right'].includes(bounds.dockSide)
    )
      throw new Error('Invalid floating bounds')
    const value = { x: bounds.x, y: bounds.y, dockSide: bounds.dockSide }
    await this.enqueue(() => this.deps.desktopSettings.setFloatingButtonBounds(value))
  }

  async getShortcutKeys(): Promise<ShortcutKeySetting> {
    return await this.enqueue(() => this.deps.desktopSettings.getShortcutKeys())
  }

  async setShortcutKeys(shortcuts: ShortcutKeySetting): Promise<ShortcutKeySetting> {
    return await this.enqueue(() => {
      this.deps.desktopSettings.setShortcutKeys(shortcuts)
      return this.deps.desktopSettings.getShortcutKeys()
    })
  }

  async resetShortcutKeys(): Promise<ShortcutKeySetting> {
    return await this.enqueue(() => {
      this.deps.desktopSettings.resetShortcutKeys()
      return this.deps.desktopSettings.getShortcutKeys()
    })
  }

  async getUpdateChannel(): Promise<'stable' | 'beta'> {
    return await this.enqueue(() => this.deps.updateSettings.getChannel())
  }

  async setUpdateChannel(channel: 'stable' | 'beta'): Promise<'stable' | 'beta'> {
    return await this.enqueue(() => {
      this.deps.updateSettings.setChannel(channel)
      this.publishNativeSnapshot()
      return this.deps.updateSettings.getChannel()
    })
  }

  async initializeDesktop(): Promise<void> {
    await this.enqueue(() => this.deps.desktopSettings.initialize())
  }

  async listSystemFonts(): Promise<string[]> {
    return await this.enqueue(() => this.deps.fonts.getSystemFonts())
  }

  async openLoggingFolder(): Promise<void> {
    await this.enqueue(() => this.deps.logging.openFolder())
  }

  async observeSystemTheme(): Promise<void> {
    this.deps.assertActive()
    if (!this.accepting) throw new Error('Settings owner is stopped')
    if (this.systemThemeObservation) return await this.systemThemeObservation
    // Reserve the single coalesced observation so a full command queue cannot lose an OS change.
    const pending = this.enqueue(async () => {
      this.systemThemeObservation = undefined
      await this.deps.desktopSettings.observeSystemTheme()
    }, true)
    this.systemThemeObservation = pending
    const clear = () => {
      if (this.systemThemeObservation === pending) this.systemThemeObservation = undefined
    }
    void pending.then(clear, clear)
    await pending
  }

  private readLanguage(): DeepchatRouteOutput<'config.getLanguage'> {
    const locale = this.deps.desktopSettings.getLanguage()
    return {
      requestedLanguage: this.deps.desktopSettings.getRequestedLanguage(),
      locale,
      direction: getLocaleDirection(locale)
    }
  }

  async getLanguage(): Promise<DeepchatRouteOutput<'config.getLanguage'>> {
    return await this.enqueue(() => this.readLanguage())
  }

  async setLanguage(language: string): Promise<DeepchatRouteOutput<'config.setLanguage'>> {
    const input = configSetLanguageRoute.input.parse({ language })
    return await this.enqueue(async () => {
      await this.deps.desktopSettings.setLanguage(input.language)
      return this.readLanguage()
    })
  }

  private async readTheme(): Promise<DeepchatRouteOutput<'config.getTheme'>> {
    return {
      theme: this.deps.desktopSettings.getTheme(),
      isDark: await this.deps.desktopSettings.getCurrentThemeIsDark()
    }
  }

  async getTheme(): Promise<DeepchatRouteOutput<'config.getTheme'>> {
    return await this.enqueue(() => this.readTheme())
  }

  async setTheme(
    theme: 'dark' | 'light' | 'system'
  ): Promise<DeepchatRouteOutput<'config.setTheme'>> {
    const input = configSetThemeRoute.input.parse({ theme })
    return await this.enqueue(async () => ({
      theme: input.theme,
      isDark: await this.deps.desktopSettings.setTheme(input.theme)
    }))
  }

  private readonly readSnapshot = async (
    keys?: SettingsKey[]
  ): Promise<Partial<SettingsSnapshotValues>> => {
    const values: Partial<SettingsSnapshotValues> = {
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
      traceDebugEnabled: this.deps.traceSettings.isEnabled(),
      copyWithCotEnabled: this.deps.desktopSettings.getCopyWithCotEnabled(),
      loggingEnabled: this.deps.logging.getEnabled(),
      ocrAutoExtractForNonVisionModels: this.deps.ocr.getAutomaticExtractionEnabled(),
      ocrBackend: this.deps.ocr.getBackend()
    }
    if (!keys?.length || keys.includes('launchAtLoginEnabled')) {
      values.launchAtLoginEnabled = await this.deps.desktopSettings.getLaunchAtLoginEnabled()
    }
    return this.pickSnapshot(values, keys)
  }
  private readonly pickSnapshot = (
    snapshot: Partial<SettingsSnapshotValues>,
    keys?: SettingsKey[]
  ): Partial<SettingsSnapshotValues> => {
    const result: Partial<SettingsSnapshotValues> = {}
    for (const key of keys?.length ? keys : SETTINGS_KEYS) {
      ;(result as Record<SettingsKey, SettingsSnapshotValues[SettingsKey] | undefined>)[key] =
        snapshot[key]
    }
    return result
  }
  private readonly applyChange = (change: SettingsChange): void | Promise<void> => {
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
        return this.deps.desktopSettings.setContentProtectionEnabled(change.value)
      case 'privacyModeEnabled':
        this.deps.privacy.setEnabled(change.value)
        this.publishNativeSnapshot()
        return
      case 'notificationsEnabled':
        this.deps.desktopSettings.setNotificationsEnabled(change.value)
        return
      case 'launchAtLoginEnabled':
        return this.deps.desktopSettings.setLaunchAtLoginEnabled(change.value)
      case 'traceDebugEnabled':
        this.deps.traceSettings.setEnabled(change.value)
        return
      case 'copyWithCotEnabled':
        this.deps.desktopSettings.setCopyWithCotEnabled(change.value)
        return
      case 'loggingEnabled':
        return this.deps.logging.setEnabled(change.value)
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
    return await this.enqueue(async () => {
      const version = this.deps.nextVersion()
      return { version, values: await this.readSnapshot(input.keys) }
    })
  }

  async update(changes: SettingsChange[]): Promise<DeepchatRouteOutput<'settings.update'>> {
    const input = settingsUpdateRoute.input.parse({ changes })
    return await this.enqueue(async () => {
      for (const change of input.changes) {
        const pending = this.applyChange(change)
        if (pending) await pending
        this.recordChange(change)
      }
      const changedKeys = input.changes.map((change) => change.key)
      const values = await this.readSnapshot(changedKeys)
      return { version: this.deps.nextVersion(), changedKeys, values }
    })
  }

  async publishSnapshot(): Promise<void> {
    await this.enqueue(async () => {
      this.publishNativeSnapshot()
      const version = this.deps.nextVersion()
      this.deps.publishEvent('settings.changed', {
        version,
        changedKeys: [...SETTINGS_KEYS],
        values: await this.readSnapshot()
      })
    })
  }

  async applyDisplayChange(raw: ChatSettingMutation): Promise<ApplyChatSettingSuccess> {
    const change = ChatSettingMutationSchema.parse(raw)
    return await this.enqueue(async () => {
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
          await settings.setLanguage(change.value)
          break
        case 'theme':
          previousValue = settings.getTheme()
          await settings.setTheme(change.value)
          break
      }
      return { ok: true, id: change.id, value: change.value, previousValue, appliedAt: Date.now() }
    })
  }
}
