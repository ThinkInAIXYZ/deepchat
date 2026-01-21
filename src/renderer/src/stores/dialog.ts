import { defineStore } from 'pinia'
import { useDialogStoreService } from '@/composables/dialog/useDialogStoreService'

export const useDialogStore = defineStore('dialog', () => {
  return useDialogStoreService()
})
