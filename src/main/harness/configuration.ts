import { z } from 'zod'
import type { DesktopSettingsHost } from '@/desktop/settings'
import type { LoggingHost } from '@/app/logging'
import type { NativeConfigurationSnapshot } from '@shared/types/nativeConfiguration'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { CoreConfigurationNativeSchema } from '@shared/harness/configuration'
import type { CoreNativeMethod } from '@shared/harness/core'

export function createCoreConfigurationNative(options: {
  desktop: DesktopSettingsHost
  logging: LoggingHost
  enumerateFonts(): Promise<string[]>
  publishNativeSnapshot(snapshot: NativeConfigurationSnapshot): void | Promise<void>
  publishEvent: DeepchatEventPublisher
}) {
  return async (method: CoreNativeMethod, args: unknown): Promise<unknown> => {
    if (method !== 'configuration') throw new Error('Unsupported Native configuration capability')
    const [command] = z.tuple([CoreConfigurationNativeSchema]).parse(args)
    switch (command.operation) {
      case 'readTheme':
        return await options.desktop.readTheme()
      case 'applyTheme':
        return await options.desktop.applyTheme(command.theme)
      case 'refreshLanguage':
        return await options.desktop.refreshLanguage(command.locale)
      case 'refreshTheme':
        return await options.desktop.refreshTheme(command.isDark)
      case 'readLaunchAtLogin':
        return await options.desktop.readLaunchAtLogin()
      case 'setLaunchAtLogin':
        return await options.desktop.setLaunchAtLogin(command.enabled)
      case 'applyContentProtection':
        return await options.desktop.applyContentProtection(command.enabled)
      case 'applyFloatingButtonEnabled':
        return await options.desktop.applyFloatingButtonEnabled(command.enabled)
      case 'applyLogging':
        return await options.logging.applyLogging(command.enabled)
      case 'openLoggingFolder':
        return await options.logging.openLoggingFolder()
      case 'enumerateFonts':
        return await options.enumerateFonts()
      case 'snapshot':
        return await options.publishNativeSnapshot(command.snapshot)
      case 'events':
        for (const event of command.events) options.publishEvent(event.name, event.payload)
        return
    }
  }
}
