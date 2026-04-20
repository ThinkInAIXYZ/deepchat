import { defineStore } from 'pinia'
import { onMounted, ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/presenter'
import { useLegacyShortcutPresenter } from '@api/legacy/presenters'
import { ConfigClient } from '../../api/ConfigClient'

export const useShortcutKeyStore = defineStore('shortcutKey', () => {
  const configClient = new ConfigClient()
  const shortcutKeyP = useLegacyShortcutPresenter()
  const shortcutKeys = ref<ShortcutKeySetting>()

  const loadShortcutKeys = async () => {
    const customShortcutKeys = await configClient.getShortcutKey()
    shortcutKeys.value = customShortcutKeys
  }

  const saveShortcutKeys = async () => {
    if (!shortcutKeys.value) return
    await configClient.setShortcutKey(shortcutKeys.value)
  }

  const resetShortcutKeys = async () => {
    await configClient.resetShortcutKeys()
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
