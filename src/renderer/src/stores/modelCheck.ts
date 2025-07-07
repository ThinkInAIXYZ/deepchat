import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useModelCheckStore = defineStore('modelCheck', () => {
  const isDialogOpen = ref(false)
  const currentProviderId = ref<string>('')

  const openDialog = (providerId: string) => {
    currentProviderId.value = providerId
    isDialogOpen.value = true
  }

  const closeDialog = () => {
    isDialogOpen.value = false
    currentProviderId.value = ''
  }

  return {
    isDialogOpen,
    currentProviderId,
    openDialog,
    closeDialog
  }
})
