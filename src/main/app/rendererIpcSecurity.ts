import type { IpcMainInvokeEvent } from 'electron'
import { createAppDocumentMatcher } from '@shared/rendererDocument'
import type { PluginSettingsWindowPort } from '@/plugin'

export type AuthorizeRendererIpc = (event: IpcMainInvokeEvent, routeName?: string) => void

const PLUGIN_SETTINGS_ROUTES = new Set([
  'plugins.get',
  'plugins.enable',
  'plugins.disable',
  'plugins.invokeAction'
])

export function createRendererIpcAuthorizer(options: {
  rendererDirectoryUrl: string
  developmentServerUrl?: string
  pluginSettingsWindow: Pick<PluginSettingsWindowPort, 'getPluginIdForWebContents'>
}): AuthorizeRendererIpc {
  const matchDocument = createAppDocumentMatcher(
    options.rendererDirectoryUrl,
    options.developmentServerUrl
  )

  return (event, routeName) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed() || !senderFrame || senderFrame !== sender.mainFrame) {
      throw new Error('Native IPC requires a top-level app document')
    }
    if (senderFrame.url !== sender.getURL()) {
      throw new Error('Native IPC requires the current app document')
    }

    const document = matchDocument(senderFrame.url)
    if (document === 'main' || document === 'settings') {
      return
    }
    if (document === 'splash' && routeName === 'config.getLanguage') {
      return
    }
    if (
      senderFrame.url.startsWith('file:') &&
      options.pluginSettingsWindow.getPluginIdForWebContents(sender.id) !== null &&
      routeName !== undefined &&
      PLUGIN_SETTINGS_ROUTES.has(routeName)
    ) {
      // Plugin routes independently enforce ownership of the requested plugin ID.
      return
    }
    throw new Error('Native IPC is not available to this document')
  }
}
