import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IAgentSessionPresenter, IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  SETTINGS_KEYS,
  chatSendMessageRoute,
  chatStopStreamRoute,
  sessionsCreateRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues,
  hasDeepchatRouteContract,
  settingsGetSnapshotRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'
import { publishDeepchatEvent } from './publishDeepchatEvent'

export type MainKernelRouteRuntime = {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  windowPresenter: IWindowPresenter
}

type RouteContext = {
  webContentsId: number
  windowId: number | null
}

const ALL_SETTINGS_KEYS: readonly SettingsKey[] = SETTINGS_KEYS

const readSettingsSnapshot = (configPresenter: IConfigPresenter): SettingsSnapshotValues => ({
  fontSizeLevel: configPresenter.getSetting<number>('fontSizeLevel') ?? 1,
  fontFamily: configPresenter.getFontFamily() ?? '',
  codeFontFamily: configPresenter.getCodeFontFamily() ?? '',
  artifactsEffectEnabled: configPresenter.getSetting<boolean>('artifactsEffectEnabled') ?? false,
  autoScrollEnabled: configPresenter.getAutoScrollEnabled(),
  autoCompactionEnabled: configPresenter.getAutoCompactionEnabled(),
  autoCompactionTriggerThreshold: configPresenter.getAutoCompactionTriggerThreshold(),
  autoCompactionRetainRecentPairs: configPresenter.getAutoCompactionRetainRecentPairs(),
  contentProtectionEnabled: configPresenter.getContentProtectionEnabled(),
  notificationsEnabled: configPresenter.getNotificationsEnabled(),
  traceDebugEnabled: configPresenter.getSetting<boolean>('traceDebugEnabled') ?? false,
  copyWithCotEnabled: configPresenter.getCopyWithCotEnabled(),
  loggingEnabled: configPresenter.getLoggingEnabled()
})

const pickSettingsSnapshot = (
  snapshot: SettingsSnapshotValues,
  keys?: SettingsKey[]
): Partial<SettingsSnapshotValues> => {
  const selectedKeys = keys && keys.length > 0 ? keys : ALL_SETTINGS_KEYS
  const result: Partial<SettingsSnapshotValues> = {}

  for (const key of selectedKeys) {
    ;(result as Record<SettingsKey, SettingsSnapshotValues[SettingsKey] | undefined>)[key] =
      snapshot[key]
  }

  return result
}

const applySettingChange = (configPresenter: IConfigPresenter, change: SettingsChange): void => {
  switch (change.key) {
    case 'fontSizeLevel':
      configPresenter.setSetting('fontSizeLevel', change.value)
      return
    case 'fontFamily':
      configPresenter.setFontFamily(change.value)
      return
    case 'codeFontFamily':
      configPresenter.setCodeFontFamily(change.value)
      return
    case 'artifactsEffectEnabled':
      configPresenter.setSetting('artifactsEffectEnabled', change.value)
      return
    case 'autoScrollEnabled':
      configPresenter.setAutoScrollEnabled(change.value)
      return
    case 'autoCompactionEnabled':
      configPresenter.setAutoCompactionEnabled(change.value)
      return
    case 'autoCompactionTriggerThreshold':
      configPresenter.setAutoCompactionTriggerThreshold(change.value)
      return
    case 'autoCompactionRetainRecentPairs':
      configPresenter.setAutoCompactionRetainRecentPairs(change.value)
      return
    case 'contentProtectionEnabled':
      configPresenter.setContentProtectionEnabled(change.value)
      return
    case 'notificationsEnabled':
      configPresenter.setNotificationsEnabled(change.value)
      return
    case 'traceDebugEnabled':
      configPresenter.setTraceDebugEnabled(change.value)
      return
    case 'copyWithCotEnabled':
      configPresenter.setCopyWithCotEnabled(change.value)
      return
    case 'loggingEnabled':
      configPresenter.setLoggingEnabled(change.value)
      return
  }
}

export async function dispatchDeepchatRoute(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  rawInput: unknown,
  context: RouteContext
): Promise<unknown> {
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  switch (routeName) {
    case settingsGetSnapshotRoute.name: {
      const input = settingsGetSnapshotRoute.input.parse(rawInput)
      const snapshot = readSettingsSnapshot(runtime.configPresenter)
      return settingsGetSnapshotRoute.output.parse({
        version: Date.now(),
        values: pickSettingsSnapshot(snapshot, input.keys)
      })
    }

    case settingsUpdateRoute.name: {
      const input = settingsUpdateRoute.input.parse(rawInput)
      for (const change of input.changes) {
        applySettingChange(runtime.configPresenter, change)
      }

      const snapshot = readSettingsSnapshot(runtime.configPresenter)
      const changedKeys = input.changes.map((change) => change.key)
      const values = pickSettingsSnapshot(snapshot, changedKeys)
      const version = Date.now()

      publishDeepchatEvent('settings.changed', {
        changedKeys,
        version,
        values
      })

      return settingsUpdateRoute.output.parse({
        version,
        changedKeys,
        values
      })
    }

    case sessionsCreateRoute.name: {
      const input = sessionsCreateRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.createSession(
        input,
        context.webContentsId
      )
      return sessionsCreateRoute.output.parse({ session })
    }

    case sessionsRestoreRoute.name: {
      const input = sessionsRestoreRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.getSession(input.sessionId)
      const messages = session
        ? await runtime.agentSessionPresenter.getMessages(input.sessionId)
        : []
      return sessionsRestoreRoute.output.parse({ session, messages })
    }

    case sessionsListRoute.name: {
      const input = sessionsListRoute.input.parse(rawInput)
      const sessions = await runtime.agentSessionPresenter.getSessionList(input)
      return sessionsListRoute.output.parse({ sessions })
    }

    case chatSendMessageRoute.name: {
      const input = chatSendMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.sendMessage(input.sessionId, input.content)
      return chatSendMessageRoute.output.parse({ accepted: true })
    }

    case chatStopStreamRoute.name: {
      const input = chatStopStreamRoute.input.parse(rawInput)
      let targetSessionId = input.sessionId ?? null

      if (!targetSessionId && input.requestId) {
        const message = await runtime.agentSessionPresenter.getMessage(input.requestId)
        targetSessionId = message?.sessionId ?? null
      }

      if (!targetSessionId) {
        return chatStopStreamRoute.output.parse({ stopped: false })
      }

      await runtime.agentSessionPresenter.cancelGeneration(targetSessionId)
      return chatStopStreamRoute.output.parse({ stopped: true })
    }

    case systemOpenSettingsRoute.name: {
      const input = systemOpenSettingsRoute.input.parse(rawInput)
      const navigation =
        input.routeName || input.params || input.section
          ? {
              routeName: input.routeName ?? 'settings-common',
              params: input.params,
              section: input.section
            }
          : undefined

      const windowId = await runtime.windowPresenter.createSettingsWindow(navigation)
      return systemOpenSettingsRoute.output.parse({ windowId })
    }
  }
}

export function registerMainKernelRoutes(
  ipcMain: IpcMain,
  getRuntime: () => MainKernelRouteRuntime | undefined
): void {
  ipcMain.removeHandler(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  ipcMain.handle(
    DEEPCHAT_ROUTE_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, routeName: string, rawInput: unknown) => {
      const runtime = getRuntime()
      if (!runtime) {
        throw new Error('Main kernel routes are not available before presenter initialization')
      }

      return await dispatchDeepchatRoute(runtime, routeName, rawInput, {
        webContentsId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id ?? null
      })
    }
  )
}
