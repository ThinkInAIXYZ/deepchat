import type { ProviderSettingsPort } from '@/provider/settings'
import { BrowserWindow } from 'electron'
import type { McpServicePort } from '@shared/types/mcp'
import type { IWindowPresenter } from '@shared/types/desktop'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope, type DeepchatEventPublisher } from '@shared/contracts/events'
import { DEEPLINK_EVENTS } from '@/events'
import type {
  DeeplinkDesktopPort,
  DeeplinkMcpInstallPort,
  DeeplinkProviderInstallPort,
  DeeplinkStartPayload
} from './ports'

type DeeplinkActionsDeps = {
  window: IWindowPresenter
  config: Pick<ProviderSettingsPort, 'getProviderById'>
  mcp: Pick<McpServicePort, 'isReady'>
  publishEvent: DeepchatEventPublisher
}

const resolveChatWindow = async (
  windowPresenter: IWindowPresenter
): Promise<BrowserWindow | null> => {
  const appWindows = windowPresenter.getAllWindows()
  const focusedWindow = windowPresenter.getFocusedWindow()
  const focusedChatWindow =
    focusedWindow && appWindows.some((window) => window.id === focusedWindow.id)
      ? focusedWindow
      : null

  let targetWindow: BrowserWindow | null | undefined = focusedChatWindow ?? appWindows[0]
  if (!targetWindow) {
    const windowId = await windowPresenter.createAppWindow({ initialRoute: 'chat' })
    if (windowId == null) {
      return null
    }
    targetWindow = BrowserWindow.fromId(windowId) ?? null
  }

  if (!targetWindow || targetWindow.isDestroyed()) {
    return null
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore()
  }
  targetWindow.show()
  targetWindow.focus()

  if (targetWindow.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => {
      targetWindow.webContents.once('did-finish-load', () => resolve())
    })
  }

  return targetWindow
}

class DesktopActions implements DeeplinkDesktopPort {
  constructor(private readonly windowPresenter: IWindowPresenter) {}

  async requestStart(payload: DeeplinkStartPayload): Promise<boolean> {
    const targetWindow = await resolveChatWindow(this.windowPresenter)
    return targetWindow
      ? this.windowPresenter.sendToWindow(targetWindow.id, DEEPLINK_EVENTS.START, payload)
      : false
  }
}

class McpInstallActions implements DeeplinkMcpInstallPort {
  constructor(
    private readonly windowPresenter: IWindowPresenter,
    private readonly mcpService: Pick<McpServicePort, 'isReady'>
  ) {}

  isReady(): boolean {
    return this.mcpService.isReady()
  }

  async requestInstall(mcpConfig: string): Promise<boolean> {
    const targetWindow = await resolveChatWindow(this.windowPresenter)
    return targetWindow
      ? this.windowPresenter.sendToWindow(targetWindow.id, DEEPLINK_EVENTS.MCP_INSTALL, {
          mcpConfig
        })
      : false
  }
}

class ProviderInstallActions implements DeeplinkProviderInstallPort {
  constructor(
    private readonly windowPresenter: IWindowPresenter,
    private readonly providerSettings: Pick<ProviderSettingsPort, 'getProviderById'>,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  hasProvider(providerId: string): boolean {
    return Boolean(this.providerSettings.getProviderById(providerId))
  }

  async requestInstall(preview: ProviderInstallPreview): Promise<boolean> {
    const settingsWindowId = await this.windowPresenter.createSettingsWindow()
    if (!settingsWindowId) {
      return false
    }

    this.windowPresenter.setPendingSettingsProviderInstall(preview)
    this.windowPresenter.sendSettingsNavigation(settingsWindowId, {
      routeName: 'settings-provider'
    })
    return this.windowPresenter.sendToWindow(
      settingsWindowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('settings.providerInstallRequested', {})
    )
  }

  notifyError(message: string): void {
    this.publishEvent('notification.error', {
      id: `provider-deeplink-${Date.now()}`,
      title: 'Provider Deeplink',
      message,
      type: 'error'
    })
  }
}

export const createDeeplinkActions = (deps: DeeplinkActionsDeps) => ({
  desktop: new DesktopActions(deps.window),
  mcp: new McpInstallActions(deps.window, deps.mcp),
  provider: new ProviderInstallActions(deps.window, deps.config, deps.publishEvent)
})
