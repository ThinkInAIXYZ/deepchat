import { computed, ref, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

type ActiveModelRef = Ref<{ id?: string; providerId?: string } | null>

interface UseAcpModeOptions {
  activeModel: ActiveModelRef
  conversationId: Ref<string | null>
}

interface ModeInfo {
  id: string
  name: string
  description: string
}

// Mode cycle order
const MODE_CYCLE_ORDER = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export function useAcpMode(options: UseAcpModeOptions) {
  const threadPresenter = usePresenter('threadPresenter')
  const { t } = useI18n()

  const currentMode = ref<string>('default')
  const availableModes = ref<ModeInfo[]>([])
  const loading = ref(false)

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )

  const hasConversation = computed(() => Boolean(options.conversationId.value))

  const loadModes = async () => {
    if (!isAcpModel.value || !hasConversation.value || !options.conversationId.value) {
      currentMode.value = 'default'
      availableModes.value = []
      return
    }

    loading.value = true
    try {
      const result = await threadPresenter.getAcpSessionModes(options.conversationId.value)
      if (result) {
        currentMode.value = result.current
        availableModes.value = result.available
      }
    } catch (error) {
      console.warn('[useAcpMode] Failed to load modes', error)
    } finally {
      loading.value = false
    }
  }

  watch(
    [isAcpModel, options.conversationId],
    () => {
      void loadModes()
    },
    { immediate: true }
  )

  /**
   * Cycle to the next mode in the order
   */
  const cycleMode = async () => {
    if (loading.value || !isAcpModel.value || !options.conversationId.value) {
      return
    }

    const currentIndex = MODE_CYCLE_ORDER.indexOf(currentMode.value)
    const nextIndex = (currentIndex + 1) % MODE_CYCLE_ORDER.length
    const nextModeId = MODE_CYCLE_ORDER[nextIndex]

    loading.value = true
    try {
      await threadPresenter.setAcpSessionMode(options.conversationId.value, nextModeId)
      currentMode.value = nextModeId
    } catch (error) {
      console.error('[useAcpMode] Failed to cycle mode', error)
    } finally {
      loading.value = false
    }
  }

  const currentModeInfo = computed(() => {
    return availableModes.value.find((m) => m.id === currentMode.value)
  })

  const currentModeName = computed(() => {
    const modeKey = `acpMode${currentMode.value.charAt(0).toUpperCase() + currentMode.value.slice(1)}`
    return t(`chat.input.${modeKey}`)
  })

  return {
    isAcpModel,
    currentMode,
    currentModeName,
    currentModeInfo,
    availableModes,
    cycleMode,
    loading
  }
}
