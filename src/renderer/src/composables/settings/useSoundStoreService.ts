import { onMounted, onUnmounted, ref } from 'vue'
import { useSoundAdapter } from '@/composables/settings/useSoundAdapter'

export const useSoundStoreService = () => {
  const soundEnabled = ref<boolean>(false)
  const soundAdapter = useSoundAdapter()

  let unsubscribeSound: (() => void) | null = null

  const initSound = async () => {
    try {
      soundEnabled.value = await soundAdapter.getSoundEnabled()
    } catch (error) {
      console.error('Failed to initialize sound settings:', error)
    }
  }

  const setSoundEnabled = async (enabled: boolean) => {
    soundEnabled.value = Boolean(enabled)
    await soundAdapter.setSoundEnabled(enabled)
  }

  const getSoundEnabled = async (): Promise<boolean> => {
    return await soundAdapter.getSoundEnabled()
  }

  onMounted(async () => {
    await initSound()
    unsubscribeSound = soundAdapter.onSoundEnabledChanged((enabled) => {
      soundEnabled.value = enabled
    })
  })

  onUnmounted(() => {
    unsubscribeSound?.()
    unsubscribeSound = null
  })

  return {
    soundEnabled,
    initSound,
    setSoundEnabled,
    getSoundEnabled
  }
}
