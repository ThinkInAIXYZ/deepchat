import { BrowserWindow } from 'electron'
import { appHost } from '@/platform/appHost'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope } from '@shared/contracts/events'
import type { IShortcutPresenter, ITabPresenter, IWindowPresenter } from '@shared/types/desktop'
import type { DialogServicePort } from '@shared/types/dialog'
import { readDesktopLanguageState, type DesktopSettings } from './settings'
import {
  configGetLanguageRoute,
  configGetShortcutKeysRoute,
  configGetThemeRoute,
  configResetShortcutKeysRoute,
  configSetLanguageRoute,
  configSetShortcutKeysRoute,
  configSetThemeRoute,
  dialogErrorRoute,
  dialogRespondRoute,
  shortcutDestroyRoute,
  shortcutRegisterRoute,
  shortcutUnregisterRoute,
  systemOpenSettingsRoute,
  tabCaptureCurrentAreaRoute,
  tabStitchImagesWithWatermarkRoute,
  windowCloseCurrentRoute,
  windowCloseSettingsRoute,
  windowConsumePendingSettingsProviderInstallRoute,
  windowFocusMainRoute,
  windowGetCurrentStateRoute,
  windowGetRuntimeIdentityRoute,
  windowMinimizeCurrentRoute,
  windowNotifySettingsReadyRoute,
  windowPreviewFileRoute,
  windowRequeuePendingSettingsProviderInstallRoute,
  windowResumeGuidedOnboardingRoute,
  windowStartGuidedOnboardingRoute,
  windowToggleMaximizeCurrentRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { DEV_EVENTS } from '../events'
import {
  createRouteMap,
  requireRendererCaller,
  type DeepchatRouteMap,
  type RouteContext
} from '@/routes/routeRegistry'
import type { DesktopSessionBinding } from '@/desktop/sessionBinding'

export function createDesktopRoutes(deps: {
  ownsDraftSession(sessionId: string, webContentsId: number): boolean
  windowPresenter: IWindowPresenter
  shortcutPresenter: IShortcutPresenter
  desktopSessionBinding: Pick<DesktopSessionBinding, 'getActiveId'>
  tabPresenter: ITabPresenter
  dialogService: DialogServicePort
  settings: DesktopSettings
  recordActivity(input: SettingsActivityInput): void
}): DeepchatRouteMap {
  const { windowPresenter, shortcutPresenter, tabPresenter, dialogService } = deps
  const readWindowState = (context: RouteContext) => {
    const caller = requireRendererCaller(context)
    const window = caller.windowId == null ? null : BrowserWindow.fromId(caller.windowId)
    const exists = Boolean(window && !window.isDestroyed())
    return {
      windowId: caller.windowId,
      exists,
      isMaximized: exists ? window!.isMaximized() : false,
      isFullScreen: exists ? window!.isFullScreen() : false,
      isFocused: exists ? windowPresenter.isMainWindowFocused(caller.windowId!) : false
    }
  }
  const readLanguage = () => readDesktopLanguageState(deps.settings)
  const readTheme = () => ({
    theme: deps.settings.getTheme(),
    isDark: deps.settings.getCurrentThemeIsDark()
  })

  return createRouteMap([
    [
      configGetLanguageRoute.name,
      async (rawInput) => {
        configGetLanguageRoute.input.parse(rawInput)
        return configGetLanguageRoute.output.parse(readLanguage())
      }
    ],
    [
      configSetLanguageRoute.name,
      async (rawInput) => {
        const input = configSetLanguageRoute.input.parse(rawInput)
        deps.settings.setLanguage(input.language)
        return configSetLanguageRoute.output.parse(readLanguage())
      }
    ],
    [
      configGetThemeRoute.name,
      async (rawInput) => {
        configGetThemeRoute.input.parse(rawInput)
        return configGetThemeRoute.output.parse(readTheme())
      }
    ],
    [
      configSetThemeRoute.name,
      async (rawInput) => {
        const input = configSetThemeRoute.input.parse(rawInput)
        deps.settings.setTheme(input.theme)
        return configSetThemeRoute.output.parse(readTheme())
      }
    ],
    [
      configGetShortcutKeysRoute.name,
      async (rawInput) => {
        configGetShortcutKeysRoute.input.parse(rawInput)
        return configGetShortcutKeysRoute.output.parse({
          shortcuts: deps.settings.getShortcutKeys()
        })
      }
    ],
    [
      configSetShortcutKeysRoute.name,
      async (rawInput) => {
        const input = configSetShortcutKeysRoute.input.parse(rawInput)
        deps.settings.setShortcutKeys(input.shortcuts)
        return configSetShortcutKeysRoute.output.parse({
          shortcuts: deps.settings.getShortcutKeys()
        })
      }
    ],
    [
      configResetShortcutKeysRoute.name,
      async (rawInput) => {
        configResetShortcutKeysRoute.input.parse(rawInput)
        deps.settings.resetShortcutKeys()
        deps.recordActivity({
          category: 'shortcut',
          action: 'reset',
          targetType: 'shortcut',
          targetLabel: 'Shortcuts',
          routeName: 'settings-shortcut',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: 'shortcuts' }
        })
        return configResetShortcutKeysRoute.output.parse({
          shortcuts: deps.settings.getShortcutKeys()
        })
      }
    ],
    [
      shortcutRegisterRoute.name,
      async (rawInput) => {
        shortcutRegisterRoute.input.parse(rawInput)
        shortcutPresenter.registerShortcuts()
        return shortcutRegisterRoute.output.parse({ registered: true })
      }
    ],
    [
      shortcutUnregisterRoute.name,
      async (rawInput) => {
        shortcutUnregisterRoute.input.parse(rawInput)
        shortcutPresenter.unregisterShortcuts()
        return shortcutUnregisterRoute.output.parse({ unregistered: true })
      }
    ],
    [
      shortcutDestroyRoute.name,
      async (rawInput) => {
        shortcutDestroyRoute.input.parse(rawInput)
        shortcutPresenter.destroy()
        return shortcutDestroyRoute.output.parse({ destroyed: true })
      }
    ],
    [
      windowGetCurrentStateRoute.name,
      async (rawInput, context) => {
        windowGetCurrentStateRoute.input.parse(rawInput)
        return windowGetCurrentStateRoute.output.parse({ state: readWindowState(context) })
      }
    ],
    [
      windowGetRuntimeIdentityRoute.name,
      async (rawInput, context) => {
        windowGetRuntimeIdentityRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return windowGetRuntimeIdentityRoute.output.parse({
          windowId: caller.windowId,
          webContentsId: caller.webContentsId
        })
      }
    ],
    [
      windowMinimizeCurrentRoute.name,
      async (rawInput, context) => {
        windowMinimizeCurrentRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        if (caller.windowId != null) windowPresenter.minimize(caller.windowId)
        return windowMinimizeCurrentRoute.output.parse({ state: readWindowState(context) })
      }
    ],
    [
      windowToggleMaximizeCurrentRoute.name,
      async (rawInput, context) => {
        windowToggleMaximizeCurrentRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        if (caller.windowId != null) windowPresenter.maximize(caller.windowId)
        return windowToggleMaximizeCurrentRoute.output.parse({ state: readWindowState(context) })
      }
    ],
    [
      windowCloseCurrentRoute.name,
      async (rawInput, context) => {
        windowCloseCurrentRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        if (caller.windowId == null) return windowCloseCurrentRoute.output.parse({ closed: false })
        windowPresenter.close(caller.windowId)
        return windowCloseCurrentRoute.output.parse({ closed: true })
      }
    ],
    [
      windowPreviewFileRoute.name,
      async (rawInput) => {
        const input = windowPreviewFileRoute.input.parse(rawInput)
        windowPresenter.previewFile(input.filePath)
        return windowPreviewFileRoute.output.parse({ previewed: true })
      }
    ],
    [
      windowCloseSettingsRoute.name,
      async (rawInput) => {
        windowCloseSettingsRoute.input.parse(rawInput)
        const closed = windowPresenter.getSettingsWindowId() != null
        windowPresenter.closeSettingsWindow()
        return windowCloseSettingsRoute.output.parse({ closed })
      }
    ],
    [
      windowFocusMainRoute.name,
      async (rawInput) => {
        windowFocusMainRoute.input.parse(rawInput)
        return windowFocusMainRoute.output.parse({ focused: windowPresenter.focusMainWindow() })
      }
    ],
    [
      windowNotifySettingsReadyRoute.name,
      async (rawInput, context) => {
        windowNotifySettingsReadyRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        windowPresenter.notifySettingsReady(caller.webContentsId)
        return windowNotifySettingsReadyRoute.output.parse({ notified: true })
      }
    ],
    [
      windowConsumePendingSettingsProviderInstallRoute.name,
      async (rawInput) => {
        windowConsumePendingSettingsProviderInstallRoute.input.parse(rawInput)
        return windowConsumePendingSettingsProviderInstallRoute.output.parse({
          preview: windowPresenter.consumePendingSettingsProviderInstall()
        })
      }
    ],
    [
      windowRequeuePendingSettingsProviderInstallRoute.name,
      async (rawInput) => {
        const input = windowRequeuePendingSettingsProviderInstallRoute.input.parse(rawInput)
        windowPresenter.setPendingSettingsProviderInstall(input.preview)
        return windowRequeuePendingSettingsProviderInstallRoute.output.parse({ queued: true })
      }
    ],
    [
      windowResumeGuidedOnboardingRoute.name,
      async (rawInput) => {
        windowResumeGuidedOnboardingRoute.input.parse(rawInput)
        const focused = windowPresenter.focusMainWindow()
        const requested = focused
          ? await windowPresenter.sendToMainWindow(
              DEEPCHAT_EVENT_CHANNEL,
              createDeepchatEventEnvelope('appRuntime.guidedOnboardingResumeRequested', {})
            )
          : false
        return windowResumeGuidedOnboardingRoute.output.parse({ requested, focused })
      }
    ],
    [
      windowStartGuidedOnboardingRoute.name,
      async (rawInput) => {
        windowStartGuidedOnboardingRoute.input.parse(rawInput)
        if (!import.meta.env.DEV || appHost.isPackaged()) {
          return windowStartGuidedOnboardingRoute.output.parse({ started: false, focused: false })
        }
        await windowPresenter.sendToAllWindows(DEV_EVENTS.START_GUIDED_ONBOARDING)
        return windowStartGuidedOnboardingRoute.output.parse({
          started: true,
          focused: windowPresenter.focusMainWindow()
        })
      }
    ],
    [
      tabCaptureCurrentAreaRoute.name,
      async (rawInput, context) => {
        const input = tabCaptureCurrentAreaRoute.input.parse(rawInput)
        const caller = requireRendererCaller(context)
        return tabCaptureCurrentAreaRoute.output.parse({
          imageData: await tabPresenter.captureTabArea(caller.webContentsId, input.rect)
        })
      }
    ],
    [
      tabStitchImagesWithWatermarkRoute.name,
      async (rawInput) => {
        const input = tabStitchImagesWithWatermarkRoute.input.parse(rawInput)
        return tabStitchImagesWithWatermarkRoute.output.parse({
          imageData: await tabPresenter.stitchImagesWithWatermark(input.images, input.watermark)
        })
      }
    ],
    [
      dialogRespondRoute.name,
      async (rawInput) => {
        const input = dialogRespondRoute.input.parse(rawInput)
        await dialogService.handleDialogResponse(input)
        return dialogRespondRoute.output.parse({ handled: true })
      }
    ],
    [
      dialogErrorRoute.name,
      async (rawInput) => {
        const input = dialogErrorRoute.input.parse(rawInput)
        await dialogService.handleDialogError(input.id)
        return dialogErrorRoute.output.parse({ handled: true })
      }
    ],
    [
      systemOpenSettingsRoute.name,
      async (rawInput) => {
        const input = systemOpenSettingsRoute.input.parse(rawInput)
        const navigation =
          input.routeName || input.params || input.section
            ? {
                routeName: input.routeName ?? 'settings-common',
                params: input.params,
                section: input.section
              }
            : undefined
        return systemOpenSettingsRoute.output.parse({
          windowId: await windowPresenter.createSettingsWindow(navigation)
        })
      }
    ]
  ])
}
