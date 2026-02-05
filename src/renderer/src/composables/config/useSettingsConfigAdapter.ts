import type { IPresenter, ShortcutKeySetting } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

type ConfigPresenter = IPresenter['configPresenter']

export type UiSettingsSnapshot = {
  fontSizeLevel: number | null
  fontFamily: string | null
  codeFontFamily: string | null
  artifactsEffectEnabled: boolean | null
  searchPreviewEnabled: boolean | null
  autoScrollEnabled: boolean | null
  contentProtectionEnabled: boolean | null
  copyWithCotEnabled: boolean | null
  traceDebugEnabled: boolean | null
  notificationsEnabled: boolean | null
  loggingEnabled: boolean | null
}

type UiSettingsUpdate = Partial<UiSettingsSnapshot>
type Unsubscribe = () => void

const noopUnsubscribe = () => undefined

const subscribeEvent = <T>(
  event: string,
  handler: (payload: T) => void,
  transform?: (...args: unknown[]) => T
): Unsubscribe => {
  if (!window?.electron?.ipcRenderer) return noopUnsubscribe

  const listener = (...args: unknown[]) => {
    const payload = transform ? transform(...args) : (args[1] as T)
    handler(payload)
  }

  window.electron.ipcRenderer.on(event, listener)

  return () => {
    window.electron.ipcRenderer.removeListener(event, listener)
  }
}

export const createSettingsConfigAdapter = (configPresenter: ConfigPresenter) => {
  const loadUiSettings = async (): Promise<UiSettingsSnapshot> => {
    return {
      fontSizeLevel: (await configPresenter.getSetting<number>('fontSizeLevel')) ?? null,
      fontFamily: (await configPresenter.getFontFamily()) ?? null,
      codeFontFamily: (await configPresenter.getCodeFontFamily()) ?? null,
      artifactsEffectEnabled:
        (await configPresenter.getSetting<boolean>('artifactsEffectEnabled')) ?? null,
      searchPreviewEnabled: (await configPresenter.getSearchPreviewEnabled()) ?? null,
      autoScrollEnabled: (await configPresenter.getAutoScrollEnabled()) ?? null,
      contentProtectionEnabled: (await configPresenter.getContentProtectionEnabled()) ?? null,
      copyWithCotEnabled: (await configPresenter.getCopyWithCotEnabled()) ?? null,
      traceDebugEnabled: (await configPresenter.getSetting<boolean>('traceDebugEnabled')) ?? null,
      notificationsEnabled: (await configPresenter.getNotificationsEnabled()) ?? null,
      loggingEnabled: (await configPresenter.getLoggingEnabled()) ?? null
    }
  }

  const setFontSizeLevel = async (level: number) => {
    await configPresenter.setSetting('fontSizeLevel', level)
  }

  const setFontFamily = async (value: string) => {
    await configPresenter.setFontFamily(value)
  }

  const setCodeFontFamily = async (value: string) => {
    await configPresenter.setCodeFontFamily(value)
  }

  const resetFontSettings = async () => {
    await configPresenter.resetFontSettings()
  }

  const getSystemFonts = async () => {
    return configPresenter.getSystemFonts()
  }

  const setArtifactsEffectEnabled = async (enabled: boolean) => {
    await configPresenter.setSetting('artifactsEffectEnabled', enabled)
  }

  const setSearchPreviewEnabled = async (enabled: boolean) => {
    await configPresenter.setSearchPreviewEnabled(enabled)
  }

  const setAutoScrollEnabled = async (enabled: boolean) => {
    await configPresenter.setAutoScrollEnabled(enabled)
  }

  const setContentProtectionEnabled = async (enabled: boolean) => {
    await configPresenter.setContentProtectionEnabled(enabled)
  }

  const setCopyWithCotEnabled = async (enabled: boolean) => {
    await configPresenter.setCopyWithCotEnabled(enabled)
  }

  const setTraceDebugEnabled = async (enabled: boolean) => {
    await configPresenter.setTraceDebugEnabled(enabled)
  }

  const setNotificationsEnabled = async (enabled: boolean) => {
    await configPresenter.setNotificationsEnabled(enabled)
  }

  const setLoggingEnabled = async (enabled: boolean) => {
    await configPresenter.setLoggingEnabled(enabled)
  }

  const loadShortcutKeys = async () => {
    return configPresenter.getShortcutKey()
  }

  const saveShortcutKeys = async (keys?: ShortcutKeySetting) => {
    await configPresenter.setShortcutKey(keys)
  }

  const resetShortcutKeys = async () => {
    await configPresenter.resetShortcutKeys()
  }

  const subscribeUiSettingsChanged = (handler: (update: UiSettingsUpdate) => void): Unsubscribe => {
    const unsubscribers: Unsubscribe[] = [
      subscribeEvent<number>(CONFIG_EVENTS.FONT_SIZE_CHANGED, (value) => {
        handler({ fontSizeLevel: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED, (value) => {
        handler({ searchPreviewEnabled: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.AUTO_SCROLL_CHANGED, (value) => {
        handler({ autoScrollEnabled: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, (value) => {
        handler({ contentProtectionEnabled: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.COPY_WITH_COT_CHANGED, (value) => {
        handler({ copyWithCotEnabled: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.TRACE_DEBUG_CHANGED, (value) => {
        handler({ traceDebugEnabled: value })
      }),
      subscribeEvent<boolean>(CONFIG_EVENTS.NOTIFICATIONS_CHANGED, (value) => {
        handler({ notificationsEnabled: value })
      }),
      subscribeEvent<string | null>(CONFIG_EVENTS.FONT_FAMILY_CHANGED, (value) => {
        handler({ fontFamily: value ?? '' })
      }),
      subscribeEvent<string | null>(CONFIG_EVENTS.CODE_FONT_FAMILY_CHANGED, (value) => {
        handler({ codeFontFamily: value ?? '' })
      })
    ]

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }

  return {
    loadUiSettings,
    setFontSizeLevel,
    setFontFamily,
    setCodeFontFamily,
    resetFontSettings,
    getSystemFonts,
    setArtifactsEffectEnabled,
    setSearchPreviewEnabled,
    setAutoScrollEnabled,
    setContentProtectionEnabled,
    setCopyWithCotEnabled,
    setTraceDebugEnabled,
    setNotificationsEnabled,
    setLoggingEnabled,
    loadShortcutKeys,
    saveShortcutKeys,
    resetShortcutKeys,
    subscribeUiSettingsChanged
  }
}

export function useSettingsConfigAdapter() {
  const configPresenter = usePresenter('configPresenter')
  return createSettingsConfigAdapter(configPresenter)
}
