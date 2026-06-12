import { defineStore } from 'pinia'
import { onMounted, ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/presenter'
import { createShortcutClient } from '@api/ShortcutClient'
import { createConfigClient } from '../../api/ConfigClient'

export const useShortcutKeyStore = defineStore('shortcutKey', () => {
  const configClient = createConfigClient()
  const shortcutClient = createShortcutClient()
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
    await shortcutClient.registerShortcuts()
  }

  const disableShortcutKey = async () => {
    await shortcutClient.destroy()
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
