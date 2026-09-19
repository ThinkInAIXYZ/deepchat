import type { SearchResult } from '@shared/types/core/search'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useReferenceStore = defineStore('reference', () => {
  const currentReference = ref<SearchResult | undefined>()
  const showPreview = ref(false)
  const previewRect = ref<DOMRect | undefined>()
  const showReference = (reference: SearchResult, rect: DOMRect) => {
    currentReference.value = reference
    previewRect.value = rect
    showPreview.value = true
  }

  const hideReference = () => {
    currentReference.value = undefined
    previewRect.value = undefined
    showPreview.value = false
  }

  return {
    currentReference,
    showPreview,
    previewRect,
    showReference,
    hideReference
  }
})
