import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProviderInstallPreview } from '@shared/presenter'

export const useProviderDeeplinkImportStore = defineStore('providerDeeplinkImport', () => {
  const preview = ref<ProviderInstallPreview | null>(null)

  const openPreview = (nextPreview: ProviderInstallPreview) => {
    preview.value = nextPreview
  }

  const clearPreview = () => {
    preview.value = null
  }

  return {
    preview,
    openPreview,
    clearPreview
  }
})
