import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'
import { buildFontStack, DEFAULT_CODE_FONT_STACK, DEFAULT_TEXT_FONT_STACK } from '@/lib/fontStack'

const FONT_SIZE_CLASSES = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const DEFAULT_FONT_SIZE_LEVEL = 1
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN = 5
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX = 95
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP = 5
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT = 80
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN = 1
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX = 10
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT = 2

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const configP = usePresenter('configPresenter')

  const fontSizeLevel = ref(DEFAULT_FONT_SIZE_LEVEL)
  const fontFamily = ref('')
  const codeFontFamily = ref('')
  const systemFonts = ref<string[]>([])
  const isLoadingFonts = ref(false)
  const artifactsEffectEnabled = ref(false)
  const autoScrollEnabled = ref(true)
  const contentProtectionEnabled = ref(false)
  const copyWithCotEnabled = ref(true)
  const autoCompactionEnabled = ref(true)
  const autoCompactionTriggerThreshold = ref(AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT)
  const autoCompactionRetainRecentPairs = ref(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT)
  const traceDebugEnabled = ref(false)
  const notificationsEnabled = ref(true)
  const loggingEnabled = ref(false)

  const fontSizeClass = computed(
    () => FONT_SIZE_CLASSES[fontSizeLevel.value] || FONT_SIZE_CLASSES[DEFAULT_FONT_SIZE_LEVEL]
  )

  const formattedFontFamily = computed(() =>
    buildFontStack(fontFamily.value, DEFAULT_TEXT_FONT_STACK)
  )
  const formattedCodeFontFamily = computed(() =>
    buildFontStack(codeFontFamily.value, DEFAULT_CODE_FONT_STACK)
  )

  const loadSettings = async () => {
    fontSizeLevel.value =
      (await configP.getSetting<number>('fontSizeLevel')) ?? DEFAULT_FONT_SIZE_LEVEL
    if (fontSizeLevel.value < 0 || fontSizeLevel.value >= FONT_SIZE_CLASSES.length) {
      fontSizeLevel.value = DEFAULT_FONT_SIZE_LEVEL
    }
    fontFamily.value = (await configP.getFontFamily()) ?? ''
    codeFontFamily.value = (await configP.getCodeFontFamily()) ?? ''
    artifactsEffectEnabled.value =
      (await configP.getSetting<boolean>('artifactsEffectEnabled')) ?? false
    autoScrollEnabled.value = (await configP.getAutoScrollEnabled()) ?? true
    autoCompactionEnabled.value = (await configP.getAutoCompactionEnabled()) ?? true
    autoCompactionTriggerThreshold.value =
      (await configP.getAutoCompactionTriggerThreshold()) ??
      AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT
    autoCompactionRetainRecentPairs.value =
      (await configP.getAutoCompactionRetainRecentPairs()) ??
      AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT
    contentProtectionEnabled.value = await configP.getContentProtectionEnabled()
    notificationsEnabled.value = (await configP.getSetting<boolean>('notificationsEnabled')) ?? true
    traceDebugEnabled.value = (await configP.getSetting<boolean>('traceDebugEnabled')) ?? false
    copyWithCotEnabled.value = await configP.getCopyWithCotEnabled()
    loggingEnabled.value = await configP.getLoggingEnabled()
  }

  const updateFontSizeLevel = async (level: number) => {
    const validLevel = Math.max(0, Math.min(level, FONT_SIZE_CLASSES.length - 1))
    fontSizeLevel.value = validLevel
    await configP.setSetting('fontSizeLevel', validLevel)
  }

  const setFontFamily = async (value: string) => {
    fontFamily.value = (value || '').trim()
    await configP.setFontFamily(fontFamily.value)
  }

  const setCodeFontFamily = async (value: string) => {
    codeFontFamily.value = (value || '').trim()
    await configP.setCodeFontFamily(codeFontFamily.value)
  }

  const resetFontSettings = async () => {
    fontFamily.value = ''
    codeFontFamily.value = ''
    await configP.resetFontSettings()
  }

  const fetchSystemFonts = async () => {
    if (isLoadingFonts.value || systemFonts.value.length > 0) return
    isLoadingFonts.value = true
    try {
      const fonts = await configP.getSystemFonts()
      systemFonts.value = fonts || []
    } catch (error) {
      console.warn('Failed to fetch system fonts', error)
    } finally {
      isLoadingFonts.value = false
    }
  }

  const setAutoScrollEnabled = async (enabled: boolean) => {
    autoScrollEnabled.value = enabled
    await configP.setAutoScrollEnabled(enabled)
  }

  const setAutoCompactionEnabled = async (enabled: boolean) => {
    autoCompactionEnabled.value = Boolean(enabled)
    await configP.setAutoCompactionEnabled(autoCompactionEnabled.value)
  }

  const setAutoCompactionTriggerThreshold = async (threshold: number) => {
    const rounded =
      Math.round(threshold / AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP) *
      AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP
    const nextValue = Math.min(
      AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX,
      Math.max(AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN, rounded)
    )
    autoCompactionTriggerThreshold.value = nextValue
    await configP.setAutoCompactionTriggerThreshold(nextValue)
  }

  const setAutoCompactionRetainRecentPairs = async (count: number) => {
    const nextValue = Math.min(
      AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX,
      Math.max(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN, Math.round(count))
    )
    autoCompactionRetainRecentPairs.value = nextValue
    await configP.setAutoCompactionRetainRecentPairs(nextValue)
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
    window.electron.ipcRenderer.on(CONFIG_EVENTS.AUTO_SCROLL_CHANGED, (_event, value) => {
      autoScrollEnabled.value = value
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
    window.electron.ipcRenderer.on(CONFIG_EVENTS.FONT_FAMILY_CHANGED, (_event, value) => {
      fontFamily.value = value ?? ''
    })
    window.electron.ipcRenderer.on(CONFIG_EVENTS.CODE_FONT_FAMILY_CHANGED, (_event, value) => {
      codeFontFamily.value = value ?? ''
    })
  }

  onMounted(() => {
    loadSettings()
    setupListeners()
  })

  onBeforeUnmount(() => {
    if (!window?.electron?.ipcRenderer) return
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.FONT_SIZE_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.AUTO_SCROLL_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.COPY_WITH_COT_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.TRACE_DEBUG_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.NOTIFICATIONS_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.FONT_FAMILY_CHANGED)
    window.electron.ipcRenderer.removeAllListeners(CONFIG_EVENTS.CODE_FONT_FAMILY_CHANGED)
  })

  return {
    fontSizeLevel,
    fontSizeClass,
    fontFamily,
    codeFontFamily,
    systemFonts,
    isLoadingFonts,
    formattedFontFamily,
    formattedCodeFontFamily,
    artifactsEffectEnabled,
    autoScrollEnabled,
    autoCompactionEnabled,
    autoCompactionTriggerThreshold,
    autoCompactionRetainRecentPairs,
    contentProtectionEnabled,
    copyWithCotEnabled,
    traceDebugEnabled,
    notificationsEnabled,
    loggingEnabled,
    updateFontSizeLevel,
    setFontFamily,
    setCodeFontFamily,
    resetFontSettings,
    fetchSystemFonts,
    setAutoScrollEnabled,
    setAutoCompactionEnabled,
    setAutoCompactionTriggerThreshold,
    setAutoCompactionRetainRecentPairs,
    setArtifactsEffectEnabled,
    setContentProtectionEnabled,
    setCopyWithCotEnabled,
    setTraceDebugEnabled,
    setNotificationsEnabled,
    setLoggingEnabled,
    loadSettings
  }
})
