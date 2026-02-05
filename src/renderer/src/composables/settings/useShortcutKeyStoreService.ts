import { onMounted, ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/presenter'
import { useSettingsConfigAdapter } from '@/composables/config/useSettingsConfigAdapter'
import { useShortcutAdapter } from '@/composables/settings/useShortcutAdapter'

export const useShortcutKeyStoreService = () => {
  const settingsAdapter = useSettingsConfigAdapter()
  const shortcutAdapter = useShortcutAdapter()
  const shortcutKeys = ref<ShortcutKeySetting>()

  const loadShortcutKeys = async () => {
    shortcutKeys.value = await settingsAdapter.loadShortcutKeys()
  }

  const saveShortcutKeys = async () => {
    await settingsAdapter.saveShortcutKeys(shortcutKeys.value)
  }

  const resetShortcutKeys = async () => {
    await settingsAdapter.resetShortcutKeys()
    await loadShortcutKeys()
  }

  const enableShortcutKey = async () => {
    shortcutAdapter.registerShortcuts()
  }

  const disableShortcutKey = async () => {
    shortcutAdapter.destroyShortcuts()
  }

  onMounted(async () => {
    await loadShortcutKeys()
  })

  return {
    shortcutKeys,
    loadShortcutKeys,
    saveShortcutKeys,
    resetShortcutKeys,
    enableShortcutKey,
    disableShortcutKey
  }
}
