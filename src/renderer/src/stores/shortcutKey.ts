import { defineStore } from 'pinia'
import { useShortcutKeyStoreService } from '@/composables/settings/useShortcutKeyStoreService'

export const useShortcutKeyStore = defineStore('shortcutKey', () => {
  return useShortcutKeyStoreService()
})
