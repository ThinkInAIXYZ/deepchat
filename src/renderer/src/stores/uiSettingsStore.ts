import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

const FONT_SIZE_CLASSES = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const DEFAULT_FONT_SIZE_LEVEL = 1

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const configP = usePresenter('configPresenter')

  const fontSizeLevel = ref(DEFAULT_FONT_SIZE_LEVEL)
  const artifactsEffectEnabled = ref(false)
  const searchPreviewEnabled = ref(true)
  const contentProtectionEnabled = ref(false)
  const copyWithCotEnabled = ref(true)
  const traceDebugEnabled = ref(false)
  const notificationsEnabled = ref(true)
  const loggingEnabled = ref(false)

  const fontSizeClass = computed(
    () => FONT_SIZE_CLASSES[fontSizeLevel.value] || FONT_SIZE_CLASSES[DEFAULT_FONT_SIZE_LEVEL]
  )

  const loadSettings = async () => {
    fontSizeLevel.value =
      (await configP.getSetting<number>('fontSizeLevel')) ?? DEFAULT_FONT_SIZE_LEVEL
    if (fontSizeLevel.value < 0 || fontSizeLevel.value >= FONT_SIZE_CLASSES.length) {
      fontSizeLevel.value = DEFAULT_FONT_SIZE_LEVEL
    }
    artifactsEffectEnabled.value =
      (await configP.getSetting<boolean>('artifactsEffectEnabled')) ?? false
    searchPreviewEnabled.value = await configP.getSearchPreviewEnabled()
    contentProtectionEnabled.value = await configP.getContentProtectionEnabled()
    notificationsEnabled.value = (await configP.getSetting<boolean>('notificationsEnabled')) ?? true
    traceDebugEnabled.value = (await configP.getSetting<boolean>('traceDebugEnabled')) ?? false
    copyWithCotEnabled.value = configP.getCopyWithCotEnabled()
    loggingEnabled.value = await configP.getLoggingEnabled()
  }

  const updateFontSizeLevel = async (level: number) => {
    const validLevel = Math.max(0, Math.min(level, FONT_SIZE_CLASSES.length - 1))
    fontSizeLevel.value = validLevel
    await configP.setSetting('fontSizeLevel', validLevel)
  }

  const setSearchPreviewEnabled = async (enabled: boolean) => {
    searchPreviewEnabled.value = enabled
    await configP.setSearchPreviewEnabled(enabled)
  }

  const setArtifactsEffectEnabled = async (enabled: boolean) => {
    artifactsEffectEnabled.value = enabled
    await configP.setSetting('artifactsEffectEnabled', enabled)
  }

  const setContentProtectionEnabled = async (enabled: boolean) => {
    contentProtectionEnabled.value = enabled
    await configP.setContentProtectionEnabled(enabled)
  }

  const setCopyWithCotEnabled = async (enabled: boolean) => {
    copyWithCotEnabled.value = enabled
    await configP.setCopyWithCotEnabled(enabled)
  }

  const setTraceDebugEnabled = async (enabled: boolean) => {
    traceDebugEnabled.value = enabled
    await configP.setTraceDebugEnabled(enabled)
  }

  const setNotificationsEnabled = async (enabled: boolean) => {
    notificationsEnabled.value = enabled
    await configP.setNotificationsEnabled(enabled)
  }

  const setLoggingEnabled = async (enabled: boolean) => {
    loggingEnabled.value = Boolean(enabled)
    await configP.setLoggingEnabled(enabled)
  }

  const setupListeners = () => {
    if (!window?.electron?.ipcRenderer) return
    window.electron.ipcRenderer.on(CONFIG_EVENTS.FONT_SIZE_CHANGED, (_event, value) => {
      fontSizeLevel.value = value
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED, (_event, value) => {
      searchPreviewEnabled.value = value
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED, (_event, value) => {
      contentProtectionEnabled.value = value
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.COPY_WITH_COT_CHANGED, (_event, value) => {
      copyWithCotEnabled.value = value
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.TRACE_DEBUG_CHANGED, (_event, value) => {
      traceDebugEnabled.value = value
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.NOTIFICATIONS_CHANGED, (_event, value) => {
      notificationsEnabled.value = value
    })
  }

  onMounted(() => {
    loadSettings()
    setupListeners()
  })

  onBeforeUnmount(() => {
    if (!window?.electron?.ipcRenderer) return
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.FONT_SIZE_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.SEARCH_PREVIEW_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.COPY_WITH_COT_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.TRACE_DEBUG_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.NOTIFICATIONS_CHANGED)
  })

  return {
    fontSizeLevel,
    fontSizeClass,
    artifactsEffectEnabled,
    searchPreviewEnabled,
    contentProtectionEnabled,
    copyWithCotEnabled,
    traceDebugEnabled,
    notificationsEnabled,
    loggingEnabled,
    updateFontSizeLevel,
    setSearchPreviewEnabled,
    setArtifactsEffectEnabled,
    setContentProtectionEnabled,
    setCopyWithCotEnabled,
    setTraceDebugEnabled,
    setNotificationsEnabled,
    setLoggingEnabled,
    loadSettings
  }
})
