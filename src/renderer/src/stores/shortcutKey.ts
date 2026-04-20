import { defineStore } from 'pinia'
import { onMounted, ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/presenter'
import { ShortcutRuntime } from '@api/ShortcutRuntime'
import { ConfigClient } from '../../api/ConfigClient'

export const useShortcutKeyStore = defineStore('shortcutKey', () => {
  const configClient = new ConfigClient()
  const shortcutRuntime = new ShortcutRuntime()
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
    shortcutRuntime.registerShortcuts()
  }

  const disableShortcutKey = async () => {
    shortcutRuntime.destroy()
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
