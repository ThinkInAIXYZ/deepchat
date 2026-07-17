import { BrowserWindow } from 'electron'
import type {
  IShortcutPresenter,
  ITabPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/types/desktop'
import type { DialogServicePort } from '@shared/types/dialog'
import type { DesktopSettings } from './settings'
import {
  browserAttachCurrentWindowRoute,
  browserApplyImportRoute,
  browserClearSandboxDataRoute,
  browserDestroyRoute,
  browserDetachRoute,
  browserGetStatusRoute,
  browserGoBackRoute,
  browserGoForwardRoute,
  browserLoadUrlRoute,
  browserPreviewImportRoute,
  browserReloadRoute,
  browserScanImportSourcesRoute,
  browserSetPreviewModeRoute,
  browserUpdateCurrentWindowBoundsRoute,
  configGetFloatingButtonRoute,
  configGetLanguageRoute,
  configGetShortcutKeysRoute,
  configGetThemeRoute,
  configResetShortcutKeysRoute,
  configSetFloatingButtonRoute,
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
  windowCloseFloatingCurrentRoute,
  windowCloseSettingsRoute,
  windowConsumePendingSettingsProviderInstallRoute,
  windowFocusMainRoute,
  windowGetCurrentStateRoute,
  windowGetRuntimeIdentityRoute,
  windowMinimizeCurrentRoute,
  windowNotifySettingsReadyRoute,
  windowPreviewFileRoute,
  windowRequeuePendingSettingsProviderInstallRoute,
  windowStartGuidedOnboardingRoute,
  windowToggleMaximizeCurrentRoute,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { DEV_EVENTS } from '../events'
import { createRouteMap, type DeepchatRouteMap, type RouteContext } from '@/routes/routeRegistry'

export function createDesktopRoutes(deps: {
  windowPresenter: IWindowPresenter
  shortcutPresenter: IShortcutPresenter
  browserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  dialogService: DialogServicePort
  settings: DesktopSettings
  setFloatingButtonEnabled(enabled: boolean): void
  recordActivity(input: SettingsActivityInput): void
}): DeepchatRouteMap {
  const { windowPresenter, shortcutPresenter, browserPresenter, tabPresenter, dialogService } = deps
  const readWindowState = (context: RouteContext) => {
    const window = context.windowId == null ? null : BrowserWindow.fromId(context.windowId)
    const exists = Boolean(window && !window.isDestroyed())
    return {
      windowId: context.windowId,
      exists,
      isMaximized: exists ? window!.isMaximized() : false,
      isFullScreen: exists ? window!.isFullScreen() : false,
      isFocused: exists ? windowPresenter.isMainWindowFocused(context.windowId!) : false
    }
  }
  const readBrowserStatus = async (sessionId: string) =>
    await browserPresenter.getBrowserStatus(sessionId)
  const readLanguage = () => {
    const locale = deps.settings.getLanguage()
    return {
      requestedLanguage: deps.settings.getRequestedLanguage(),
      locale,
      direction: locale === 'fa-IR' || locale === 'he-IL' ? ('rtl' as const) : ('auto' as const)
    }
  }
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
      configGetFloatingButtonRoute.name,
      async (rawInput) => {
        configGetFloatingButtonRoute.input.parse(rawInput)
        return configGetFloatingButtonRoute.output.parse({
          enabled: deps.settings.getFloatingButtonEnabled()
        })
      }
    ],
    [
      configSetFloatingButtonRoute.name,
      async (rawInput) => {
        const input = configSetFloatingButtonRoute.input.parse(rawInput)
        deps.settings.setFloatingButtonEnabled(input.enabled)
        deps.setFloatingButtonEnabled(input.enabled)
        return configSetFloatingButtonRoute.output.parse({
          enabled: deps.settings.getFloatingButtonEnabled()
        })
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
        return windowGetRuntimeIdentityRoute.output.parse({
          windowId: context.windowId,
          webContentsId: context.webContentsId
        })
      }
    ],
    [
      windowMinimizeCurrentRoute.name,
      async (rawInput, context) => {
        windowMinimizeCurrentRoute.input.parse(rawInput)
        if (context.windowId != null) windowPresenter.minimize(context.windowId)
        return windowMinimizeCurrentRoute.output.parse({ state: readWindowState(context) })
      }
    ],
    [
      windowToggleMaximizeCurrentRoute.name,
      async (rawInput, context) => {
        windowToggleMaximizeCurrentRoute.input.parse(rawInput)
        if (context.windowId != null) windowPresenter.maximize(context.windowId)
        return windowToggleMaximizeCurrentRoute.output.parse({ state: readWindowState(context) })
      }
    ],
    [
      windowCloseCurrentRoute.name,
      async (rawInput, context) => {
        windowCloseCurrentRoute.input.parse(rawInput)
        if (context.windowId == null) return windowCloseCurrentRoute.output.parse({ closed: false })
        windowPresenter.close(context.windowId)
        return windowCloseCurrentRoute.output.parse({ closed: true })
      }
    ],
    [
      windowCloseFloatingCurrentRoute.name,
      async (rawInput, context) => {
        windowCloseFloatingCurrentRoute.input.parse(rawInput)
        const window = windowPresenter.getFloatingChatWindow()?.getWindow() ?? null
        if (!window || window.isDestroyed() || window.webContents.id !== context.webContentsId) {
          return windowCloseFloatingCurrentRoute.output.parse({ closed: false })
        }
        windowPresenter.hide(window.id)
        return windowCloseFloatingCurrentRoute.output.parse({ closed: true })
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
        windowPresenter.notifySettingsReady(context.webContentsId)
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
      windowStartGuidedOnboardingRoute.name,
      async (rawInput) => {
        windowStartGuidedOnboardingRoute.input.parse(rawInput)
        await windowPresenter.sendToAllWindows(DEV_EVENTS.START_GUIDED_ONBOARDING)
        return windowStartGuidedOnboardingRoute.output.parse({
          started: true,
          focused: windowPresenter.focusMainWindow()
        })
      }
    ],
    [
      browserGetStatusRoute.name,
      async (rawInput) => {
        const input = browserGetStatusRoute.input.parse(rawInput)
        return browserGetStatusRoute.output.parse({
          status: await readBrowserStatus(input.sessionId)
        })
      }
    ],
    [
      browserLoadUrlRoute.name,
      async (rawInput, context) => {
        const input = browserLoadUrlRoute.input.parse(rawInput)
        const browser = browserPresenter as IYoBrowserPresenter & {
          loadUrl(
            sessionId: string,
            url: string,
            timeoutMs?: number,
            hostWindowId?: number
          ): Promise<Awaited<ReturnType<IYoBrowserPresenter['getBrowserStatus']>>>
        }
        return browserLoadUrlRoute.output.parse({
          status: await browser.loadUrl(
            input.sessionId,
            input.url,
            input.timeoutMs,
            context.windowId ?? undefined
          )
        })
      }
    ],
    [
      browserAttachCurrentWindowRoute.name,
      async (rawInput, context) => {
        const input = browserAttachCurrentWindowRoute.input.parse(rawInput)
        if (context.windowId == null) {
          return browserAttachCurrentWindowRoute.output.parse({ attached: false })
        }
        return browserAttachCurrentWindowRoute.output.parse({
          attached: await browserPresenter.attachSessionBrowser(input.sessionId, context.windowId)
        })
      }
    ],
    [
      browserUpdateCurrentWindowBoundsRoute.name,
      async (rawInput, context) => {
        const input = browserUpdateCurrentWindowBoundsRoute.input.parse(rawInput)
        if (context.windowId == null) {
          return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: false })
        }
        await browserPresenter.updateSessionBrowserBounds(
          input.sessionId,
          context.windowId,
          input.bounds,
          input.visible
        )
        return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: true })
      }
    ],
    [
      browserDetachRoute.name,
      async (rawInput) => {
        const input = browserDetachRoute.input.parse(rawInput)
        await browserPresenter.detachSessionBrowser(input.sessionId)
        return browserDetachRoute.output.parse({ detached: true })
      }
    ],
    [
      browserSetPreviewModeRoute.name,
      async (rawInput, context) => {
        const input = browserSetPreviewModeRoute.input.parse(rawInput)
        return browserSetPreviewModeRoute.output.parse({
          updated: await browserPresenter.setPreviewMode(
            input.sessionId,
            input.mode,
            context.windowId ?? undefined,
            input.runId
          )
        })
      }
    ],
    [
      browserDestroyRoute.name,
      async (rawInput) => {
        const input = browserDestroyRoute.input.parse(rawInput)
        await browserPresenter.destroySessionBrowser(input.sessionId)
        return browserDestroyRoute.output.parse({ destroyed: true })
      }
    ],
    [
      browserGoBackRoute.name,
      async (rawInput) => {
        const input = browserGoBackRoute.input.parse(rawInput)
        await browserPresenter.goBack(input.sessionId)
        return browserGoBackRoute.output.parse({ status: await readBrowserStatus(input.sessionId) })
      }
    ],
    [
      browserGoForwardRoute.name,
      async (rawInput) => {
        const input = browserGoForwardRoute.input.parse(rawInput)
        await browserPresenter.goForward(input.sessionId)
        return browserGoForwardRoute.output.parse({
          status: await readBrowserStatus(input.sessionId)
        })
      }
    ],
    [
      browserReloadRoute.name,
      async (rawInput) => {
        const input = browserReloadRoute.input.parse(rawInput)
        await browserPresenter.reload(input.sessionId)
        return browserReloadRoute.output.parse({ status: await readBrowserStatus(input.sessionId) })
      }
    ],
    [
      browserClearSandboxDataRoute.name,
      async (rawInput) => {
        browserClearSandboxDataRoute.input.parse(rawInput)
        await browserPresenter.clearSandboxData()
        return browserClearSandboxDataRoute.output.parse({ cleared: true })
      }
    ],
    [
      browserScanImportSourcesRoute.name,
      async (rawInput) => {
        browserScanImportSourcesRoute.input.parse(rawInput)
        return browserScanImportSourcesRoute.output.parse(
          await browserPresenter.scanImportSources()
        )
      }
    ],
    [
      browserPreviewImportRoute.name,
      async (rawInput) => {
        const input = browserPreviewImportRoute.input.parse(rawInput)
        return browserPreviewImportRoute.output.parse(
          await browserPresenter.previewImport(input.profileId)
        )
      }
    ],
    [
      browserApplyImportRoute.name,
      async (rawInput) => {
        const input = browserApplyImportRoute.input.parse(rawInput)
        return browserApplyImportRoute.output.parse(await browserPresenter.applyImport(input.token))
      }
    ],
    [
      tabCaptureCurrentAreaRoute.name,
      async (rawInput, context) => {
        const input = tabCaptureCurrentAreaRoute.input.parse(rawInput)
        return tabCaptureCurrentAreaRoute.output.parse({
          imageData: await tabPresenter.captureTabArea(context.webContentsId, input.rect)
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
