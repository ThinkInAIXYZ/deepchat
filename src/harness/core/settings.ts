import { randomUUID } from 'node:crypto'
import type { initializeCoreProfile } from '@/app/profileStartup'
import { AppSettingsService } from '@/app/settingsService'
import { LoggingService, type LoggingHost } from '@/app/logging'
import { DesktopSettings, type DesktopSettingsHost } from '@/desktop/settings'
import { FontSettings } from '@/desktop/fontSettings'
import { SkillSettings } from '@/skill/settings'
import { AgentTraceSettings } from '@/agent/traceSettings'
import { OcrSettings } from '@/ocr/ocrSettings'
import { UpdateSettings } from '@/upgrade/settings'
import { DeepChatDefaults } from '@/agent/deepchat/defaults'
import { CommandShellService } from '@/agent/shared/process/commandShellService'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import type { SettingsActivityInput } from '@shared/contracts/routes'

export function createCoreSettings(options: {
  profile: Pick<
    Awaited<ReturnType<typeof initializeCoreProfile>>,
    'settingsStore' | 'privacySettings' | 'settingsDatabase' | 'currentAppVersion'
  >
  homeDirectory: string
  ownerId?: string
  desktop: DesktopSettingsHost
  logging: LoggingHost
  enumerateFonts(): Promise<string[]>
  publishNativeSnapshot(snapshot: NativeConfigurationSnapshot): void | Promise<void>
  publishEvent: DeepchatEventPublisher
  nextVersion(): number
  assertActive(): void
}) {
  const { profile, publishEvent } = options
  let appSettingsService: AppSettingsService
  const committed = () => appSettingsService.publishNativeSnapshot()
  const desktopSettings = new DesktopSettings(
    profile.settingsStore,
    options.desktop,
    publishEvent,
    committed
  )
  const fontSettings = new FontSettings(profile.settingsStore, publishEvent, options.enumerateFonts)
  const skillSettings = new SkillSettings(profile.settingsStore, options.homeDirectory)
  const traceSettings = new AgentTraceSettings(profile.settingsStore)
  const ocrSettings = new OcrSettings(profile.settingsStore, publishEvent)
  const loggingService = new LoggingService(
    profile.settingsStore,
    options.logging,
    publishEvent,
    committed
  )
  const updateSettings = new UpdateSettings(profile.settingsStore, profile.currentAppVersion)
  const agentDefaults = new DeepChatDefaults({
    settings: profile.settingsStore,
    publishSettingChanged: (key, value) =>
      publishEvent('settings.changed', {
        changedKeys: [key],
        version: Date.now(),
        values: { [key]: value }
      })
  })
  const commandShellService = new CommandShellService({ settings: profile.settingsStore })
  const recordSettingsActivity = (input: SettingsActivityInput) => {
    void profile.settingsDatabase.recordSettingsActivity(input).catch((error) => {
      console.warn('[SettingsActivity] Failed to record settings activity:', error)
    })
  }
  appSettingsService = new AppSettingsService({
    ownerId: options.ownerId ?? randomUUID(),
    updateSettings,
    publishNativeSnapshot: options.publishNativeSnapshot,
    agentDefaults,
    privacy: profile.privacySettings,
    traceSettings,
    desktopSettings,
    fonts: fontSettings,
    logging: loggingService,
    ocr: ocrSettings,
    recordActivity: recordSettingsActivity,
    publishEvent,
    nextVersion: options.nextVersion,
    assertActive: options.assertActive
  })
  return {
    appSettingsService,
    desktopSettings,
    skillSettings,
    traceSettings,
    ocrSettings,
    agentDefaults,
    commandShellService,
    recordSettingsActivity
  }
}
