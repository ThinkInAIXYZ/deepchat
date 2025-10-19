// === Vue Core ===
import { computed, Ref } from 'vue'

// === Types ===
import type { MessageFile } from '@shared/chat'

// === Utils ===
import { approximateTokenSize } from 'tokenx'

interface ContextLengthOptions {
  inputText: Ref<string>
  selectedFiles: Ref<MessageFile[]>
  contextLength?: number
}

/**
 * Manages context length calculation and status display
 */
export function useContextLength(options: ContextLengthOptions) {
  const { inputText, selectedFiles, contextLength } = options

  // === Computed ===
  const currentContextLength = computed(() => {
    return (
      approximateTokenSize(inputText.value) +
      selectedFiles.value.reduce((acc, file) => {
        return acc + file.token
      }, 0)
    )
  })

  const currentContextLengthPercentage = computed(() => {
    return currentContextLength.value / (contextLength ?? 1000)
  })

  const currentContextLengthText = computed(() => {
    return `${Math.round(currentContextLengthPercentage.value * 100)}%`
  })

  const shouldShowContextLength = computed(() => {
    return contextLength && contextLength > 0 && currentContextLengthPercentage.value > 0.5
  })

  const contextLengthStatusClass = computed(() => {
    const percentage = currentContextLengthPercentage.value
    if (percentage > 0.9) return 'text-red-600'
    if (percentage > 0.8) return 'text-yellow-600'
    return 'text-muted-foreground'
  })

  return {
    currentContextLength,
    currentContextLengthPercentage,
    currentContextLengthText,
    shouldShowContextLength,
    contextLengthStatusClass
  }
}
