import { defineStore } from 'pinia'
import { onMounted, ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { useSettingsConfigAdapter } from '@/composables/config/useSettingsConfigAdapter'

export const useShortcutKeyStore = defineStore('shortcutKey', () => {
  const settingsAdapter = useSettingsConfigAdapter()
  const shortcutKeyP = usePresenter('shortcutPresenter')
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
    shortcutKeyP.registerShortcuts()
  }

  const disableShortcutKey = async () => {
    shortcutKeyP.destroy()
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
})
