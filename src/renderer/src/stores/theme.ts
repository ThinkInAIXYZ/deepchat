import { defineStore } from 'pinia'
import { useThemeStoreService } from '@/composables/settings/useThemeStoreService'
export type { ThemeMode } from '@/composables/settings/types'

export const useThemeStore = defineStore('theme', () => {
  return useThemeStoreService()
})
