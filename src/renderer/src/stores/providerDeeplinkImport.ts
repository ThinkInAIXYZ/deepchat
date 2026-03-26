import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProviderInstallPreview } from '@shared/presenter'

export const useProviderDeeplinkImportStore = defineStore('providerDeeplinkImport', () => {
  const preview = ref<ProviderInstallPreview | null>(null)
  const previewToken = ref(0)

  const openPreview = (nextPreview: ProviderInstallPreview) => {
    previewToken.value += 1
    preview.value = { ...nextPreview }
  }

  const clearPreview = () => {
    preview.value = null
  }

  return {
    preview,
    previewToken,
    openPreview,
    clearPreview
  }
})
