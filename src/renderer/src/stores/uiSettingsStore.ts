import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SettingsChange, SettingsSnapshotValues } from '@shared/contracts/routes'
import { buildFontStack, DEFAULT_CODE_FONT_STACK, DEFAULT_TEXT_FONT_STACK } from '@/lib/fontStack'
import { createSettingsClient } from '../../api/SettingsClient'

const FONT_SIZE_CLASSES = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const DEFAULT_FONT_SIZE_LEVEL = 1
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_MIN = 5
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_MAX = 95
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_STEP = 5
export const AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT = 80
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN = 1
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX = 10
export const AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT = 2

const clampFontSizeLevel = (level: number) =>
  Math.max(0, Math.min(level, FONT_SIZE_CLASSES.length - 1))

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const settingsClient = createSettingsClient()

  const fontSizeLevel = ref(DEFAULT_FONT_SIZE_LEVEL)
  const fontFamily = ref('')
  const codeFontFamily = ref('')
  const systemFonts = ref<string[]>([])
  const isLoadingFonts = ref(false)
  const artifactsEffectEnabled = ref(false)
  const autoScrollEnabled = ref(true)
  const contentProtectionEnabled = ref(false)
  const privacyModeEnabled = ref(false)
  const copyWithCotEnabled = ref(true)
  const autoCompactionEnabled = ref(true)
  const autoCompactionTriggerThreshold = ref(AUTO_COMPACTION_TRIGGER_THRESHOLD_DEFAULT)
  const autoCompactionRetainRecentPairs = ref(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_DEFAULT)
  const traceDebugEnabled = ref(false)
  const notificationsEnabled = ref(true)
  const loggingEnabled = ref(false)
  let unsubscribeFromSettings: (() => void) | null = null
  let settingsLoadPromise: Promise<void> | null = null

  const fontSizeClass = computed(
    () => FONT_SIZE_CLASSES[fontSizeLevel.value] || FONT_SIZE_CLASSES[DEFAULT_FONT_SIZE_LEVEL]
  )

  const formattedFontFamily = computed(() =>
    buildFontStack(fontFamily.value, DEFAULT_TEXT_FONT_STACK)
  )
  const formattedCodeFontFamily = computed(() =>
    buildFontStack(codeFontFamily.value, DEFAULT_CODE_FONT_STACK)
  )

  const applySettingsValues = (values: Partial<SettingsSnapshotValues>) => {
    if (typeof values.fontSizeLevel === 'number') {
      fontSizeLevel.value = clampFontSizeLevel(values.fontSizeLevel)
    }

    if (typeof values.fontFamily === 'string') {
      fontFamily.value = values.fontFamily
    }

    if (typeof values.codeFontFamily === 'string') {
      codeFontFamily.value = values.codeFontFamily
    }

    if (typeof values.artifactsEffectEnabled === 'boolean') {
      artifactsEffectEnabled.value = values.artifactsEffectEnabled
    }

    if (typeof values.autoScrollEnabled === 'boolean') {
      autoScrollEnabled.value = values.autoScrollEnabled
    }

    if (typeof values.autoCompactionEnabled === 'boolean') {
      autoCompactionEnabled.value = values.autoCompactionEnabled
    }

    if (typeof values.autoCompactionTriggerThreshold === 'number') {
      autoCompactionTriggerThreshold.value = values.autoCompactionTriggerThreshold
    }

    if (typeof values.autoCompactionRetainRecentPairs === 'number') {
      autoCompactionRetainRecentPairs.value = values.autoCompactionRetainRecentPairs
    }

    if (typeof values.contentProtectionEnabled === 'boolean') {
      contentProtectionEnabled.value = values.contentProtectionEnabled
    }

    if (typeof values.privacyModeEnabled === 'boolean') {
      privacyModeEnabled.value = values.privacyModeEnabled
    }

    if (typeof values.notificationsEnabled === 'boolean') {
      notificationsEnabled.value = values.notificationsEnabled
    }

    if (typeof values.traceDebugEnabled === 'boolean') {
      traceDebugEnabled.value = values.traceDebugEnabled
    }

    if (typeof values.copyWithCotEnabled === 'boolean') {
      copyWithCotEnabled.value = values.copyWithCotEnabled
    }

    if (typeof values.loggingEnabled === 'boolean') {
      loggingEnabled.value = values.loggingEnabled
    }
  }

  const updateSettings = async (changes: SettingsChange[]) => {
    if (settingsLoadPromise) {
      await settingsLoadPromise
    }

    const result = await settingsClient.update(changes)
    applySettingsValues(result.values)
  }

  const loadSettings = async () => {
    if (settingsLoadPromise) {
      await settingsLoadPromise
      return
    }

    const nextLoadPromise = (async () => {
      const snapshot = await settingsClient.getSnapshot()
      applySettingsValues(snapshot)
    })()

    settingsLoadPromise = nextLoadPromise

    try {
      await nextLoadPromise
    } finally {
      if (settingsLoadPromise === nextLoadPromise) {
        settingsLoadPromise = null
      }
    }
  }

  const updateFontSizeLevel = async (level: number) => {
    const nextValue = clampFontSizeLevel(level)
    fontSizeLevel.value = nextValue

    await updateSettings([
      {
        key: 'fontSizeLevel',
        value: nextValue
      }
    ])
  }

  const setFontFamily = async (value: string) => {
    const nextValue = (value || '').trim()
    fontFamily.value = nextValue

    await updateSettings([
      {
        key: 'fontFamily',
        value: nextValue
      }
    ])
  }

  const setCodeFontFamily = async (value: string) => {
    const nextValue = (value || '').trim()
    codeFontFamily.value = nextValue

    await updateSettings([
      {
        key: 'codeFontFamily',
        value: nextValue
      }
    ])
  }

  const resetFontSettings = async () => {
    fontFamily.value = ''
    codeFontFamily.value = ''

    await updateSettings([
      {
        key: 'fontFamily',
        value: ''
      },
      {
        key: 'codeFontFamily',
        value: ''
      }
    ])
  }

  const fetchSystemFonts = async () => {
    if (isLoadingFonts.value || systemFonts.value.length > 0) return
    isLoadingFonts.value = true
    try {
      systemFonts.value = (await settingsClient.getSystemFonts()) || []
    } catch (error) {
      console.warn('Failed to fetch system fonts', error)
    } finally {
      isLoadingFonts.value = false
    }
  }

  const setAutoScrollEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    autoScrollEnabled.value = nextValue

    await updateSettings([
      {
        key: 'autoScrollEnabled',
        value: nextValue
      }
    ])
  }

  const setAutoCompactionEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    autoCompactionEnabled.value = nextValue

    await updateSettings([
      {
        key: 'autoCompactionEnabled',
        value: nextValue
      }
    ])
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

    await updateSettings([
      {
        key: 'autoCompactionTriggerThreshold',
        value: nextValue
      }
    ])
  }

  const setAutoCompactionRetainRecentPairs = async (count: number) => {
    const nextValue = Math.min(
      AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MAX,
      Math.max(AUTO_COMPACTION_RETAIN_RECENT_PAIRS_MIN, Math.round(count))
    )
    autoCompactionRetainRecentPairs.value = nextValue

    await updateSettings([
      {
        key: 'autoCompactionRetainRecentPairs',
        value: nextValue
      }
    ])
  }

  const setArtifactsEffectEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    artifactsEffectEnabled.value = nextValue

    await updateSettings([
      {
        key: 'artifactsEffectEnabled',
        value: nextValue
      }
    ])
  }

  const setContentProtectionEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    contentProtectionEnabled.value = nextValue

    await updateSettings([
      {
        key: 'contentProtectionEnabled',
        value: nextValue
      }
    ])
  }

  const setPrivacyModeEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)

    await updateSettings([
      {
        key: 'privacyModeEnabled',
        value: nextValue
      }
    ])
  }

  const setCopyWithCotEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    copyWithCotEnabled.value = nextValue

    await updateSettings([
      {
        key: 'copyWithCotEnabled',
        value: nextValue
      }
    ])
  }

  const setTraceDebugEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    traceDebugEnabled.value = nextValue

    await updateSettings([
      {
        key: 'traceDebugEnabled',
        value: nextValue
      }
    ])
  }

  const setNotificationsEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    notificationsEnabled.value = nextValue

    await updateSettings([
      {
        key: 'notificationsEnabled',
        value: nextValue
      }
    ])
  }

  const setLoggingEnabled = async (enabled: boolean) => {
    const nextValue = Boolean(enabled)
    loggingEnabled.value = nextValue

    await updateSettings([
      {
        key: 'loggingEnabled',
        value: nextValue
      }
    ])
  }

  const setupListeners = () => {
    if (unsubscribeFromSettings) {
      return
    }

    unsubscribeFromSettings = settingsClient.onChanged((payload) => {
      applySettingsValues(payload.values)
    })
  }

  onMounted(() => {
    void loadSettings()
    setupListeners()
  })

  onBeforeUnmount(() => {
    unsubscribeFromSettings?.()
    unsubscribeFromSettings = null
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
    privacyModeEnabled,
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
    setPrivacyModeEnabled,
    setCopyWithCotEnabled,
    setTraceDebugEnabled,
    setNotificationsEnabled,
    setLoggingEnabled,
    loadSettings
  }
})
