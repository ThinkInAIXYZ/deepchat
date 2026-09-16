import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ShortcutKeySetting } from '@shared/types/desktop'
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

  // Load at store setup top level (not in a component lifecycle hook) so the data is
  // fetched regardless of which component first uses the store. No cleanup semantics.
  void loadShortcutKeys()

  return {
    shortcutKeys,
    loadShortcutKeys,
    saveShortcutKeys,
    resetShortcutKeys,
    enableShortcutKey,
    disableShortcutKey
  }
})
