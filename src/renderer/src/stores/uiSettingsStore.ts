import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { defineStore } from 'pinia'
import { buildFontStack, DEFAULT_CODE_FONT_STACK, DEFAULT_TEXT_FONT_STACK } from '@/lib/fontStack'
import {
  useSettingsConfigAdapter,
  type UiSettingsSnapshot
} from '@/composables/config/useSettingsConfigAdapter'

const FONT_SIZE_CLASSES = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const DEFAULT_FONT_SIZE_LEVEL = 1

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const settingsAdapter = useSettingsConfigAdapter()

  const fontSizeLevel = ref(DEFAULT_FONT_SIZE_LEVEL)
  const fontFamily = ref('')
  const codeFontFamily = ref('')
  const systemFonts = ref<string[]>([])
  const isLoadingFonts = ref(false)
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

  const formattedFontFamily = computed(() =>
    buildFontStack(fontFamily.value, DEFAULT_TEXT_FONT_STACK)
  )
  const formattedCodeFontFamily = computed(() =>
    buildFontStack(codeFontFamily.value, DEFAULT_CODE_FONT_STACK)
  )

  const applyFontSizeLevel = (level: number | null | undefined) => {
    const rawLevel = typeof level === 'number' ? level : DEFAULT_FONT_SIZE_LEVEL
    const validLevel = Math.max(0, Math.min(rawLevel, FONT_SIZE_CLASSES.length - 1))
    fontSizeLevel.value = validLevel
  }

  const loadSettings = async () => {
    const snapshot = await settingsAdapter.loadUiSettings()

    applyFontSizeLevel(snapshot.fontSizeLevel)
    fontFamily.value = snapshot.fontFamily ?? ''
    codeFontFamily.value = snapshot.codeFontFamily ?? ''
    artifactsEffectEnabled.value = snapshot.artifactsEffectEnabled ?? false
    searchPreviewEnabled.value = snapshot.searchPreviewEnabled ?? true
    contentProtectionEnabled.value = snapshot.contentProtectionEnabled ?? false
    notificationsEnabled.value = snapshot.notificationsEnabled ?? true
    traceDebugEnabled.value = snapshot.traceDebugEnabled ?? false
    copyWithCotEnabled.value = snapshot.copyWithCotEnabled ?? true
    loggingEnabled.value = snapshot.loggingEnabled ?? false
  }

  const updateFontSizeLevel = async (level: number) => {
    const validLevel = Math.max(0, Math.min(level, FONT_SIZE_CLASSES.length - 1))
    fontSizeLevel.value = validLevel
    await settingsAdapter.setFontSizeLevel(validLevel)
  }

  const setFontFamily = async (value: string) => {
    fontFamily.value = (value || '').trim()
    await settingsAdapter.setFontFamily(fontFamily.value)
  }

  const setCodeFontFamily = async (value: string) => {
    codeFontFamily.value = (value || '').trim()
    await settingsAdapter.setCodeFontFamily(codeFontFamily.value)
  }

  const resetFontSettings = async () => {
    fontFamily.value = ''
    codeFontFamily.value = ''
    await settingsAdapter.resetFontSettings()
  }

  const fetchSystemFonts = async () => {
    if (isLoadingFonts.value || systemFonts.value.length > 0) return
    isLoadingFonts.value = true
    try {
      const fonts = await settingsAdapter.getSystemFonts()
      systemFonts.value = fonts || []
    } catch (error) {
      console.warn('Failed to fetch system fonts', error)
    } finally {
      isLoadingFonts.value = false
    }
  }

  const setSearchPreviewEnabled = async (enabled: boolean) => {
    searchPreviewEnabled.value = enabled
    await settingsAdapter.setSearchPreviewEnabled(enabled)
  }

  const setArtifactsEffectEnabled = async (enabled: boolean) => {
    artifactsEffectEnabled.value = enabled
    await settingsAdapter.setArtifactsEffectEnabled(enabled)
  }

  const setContentProtectionEnabled = async (enabled: boolean) => {
    contentProtectionEnabled.value = enabled
    await settingsAdapter.setContentProtectionEnabled(enabled)
  }

  const setCopyWithCotEnabled = async (enabled: boolean) => {
    copyWithCotEnabled.value = enabled
    await settingsAdapter.setCopyWithCotEnabled(enabled)
  }

  const setTraceDebugEnabled = async (enabled: boolean) => {
    traceDebugEnabled.value = enabled
    await settingsAdapter.setTraceDebugEnabled(enabled)
  }

  const setNotificationsEnabled = async (enabled: boolean) => {
    notificationsEnabled.value = enabled
    await settingsAdapter.setNotificationsEnabled(enabled)
  }

  const setLoggingEnabled = async (enabled: boolean) => {
    loggingEnabled.value = Boolean(enabled)
    await settingsAdapter.setLoggingEnabled(enabled)
  }

  let unsubscribeSettings: (() => void) | null = null

  const applySettingsUpdate = (update: Partial<UiSettingsSnapshot>) => {
    if (update.fontSizeLevel !== undefined) {
      applyFontSizeLevel(update.fontSizeLevel)
    }
    if (update.searchPreviewEnabled !== undefined && update.searchPreviewEnabled !== null) {
      searchPreviewEnabled.value = update.searchPreviewEnabled
    }
    if (update.contentProtectionEnabled !== undefined && update.contentProtectionEnabled !== null) {
      contentProtectionEnabled.value = update.contentProtectionEnabled
    }
    if (update.copyWithCotEnabled !== undefined && update.copyWithCotEnabled !== null) {
      copyWithCotEnabled.value = update.copyWithCotEnabled
    }
    if (update.traceDebugEnabled !== undefined && update.traceDebugEnabled !== null) {
      traceDebugEnabled.value = update.traceDebugEnabled
    }
    if (update.notificationsEnabled !== undefined && update.notificationsEnabled !== null) {
      notificationsEnabled.value = update.notificationsEnabled
    }
    if (update.fontFamily !== undefined) {
      fontFamily.value = update.fontFamily ?? ''
    }
    if (update.codeFontFamily !== undefined) {
      codeFontFamily.value = update.codeFontFamily ?? ''
    }
  }

  const setupListeners = () => {
    unsubscribeSettings = settingsAdapter.subscribeUiSettingsChanged(applySettingsUpdate)
  }

  onMounted(() => {
    loadSettings()
    setupListeners()
  })

  onBeforeUnmount(() => {
    if (unsubscribeSettings) {
      unsubscribeSettings()
      unsubscribeSettings = null
    }
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
    searchPreviewEnabled,
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
