// === Vue Core ===
import { computed, type ComputedRef, type Ref } from 'vue'

// === Composables ===
import { useI18n } from 'vue-i18n'

// === Interfaces ===
export interface ThinkingBudgetRange {
  min?: number
  max?: number
  default?: number
}

export interface UseThinkingBudgetOptions {
  thinkingBudget: Ref<number | undefined>
  budgetRange: Ref<ThinkingBudgetRange | null>
  modelReasoning: Ref<boolean>
  supportsReasoning: Ref<boolean | null>
  isGeminiProvider: ComputedRef<boolean>
}

export interface UseThinkingBudgetReturn {
  showThinkingBudget: ComputedRef<boolean>
  validationError: ComputedRef<string>
}

/**
 * Composable for managing thinking budget logic and validation
 * Handles budget range validation, display logic, and error messages
 */
export function useThinkingBudget(options: UseThinkingBudgetOptions): UseThinkingBudgetReturn {
  const { thinkingBudget, budgetRange, modelReasoning, supportsReasoning, isGeminiProvider } =
    options
  const { t } = useI18n()

  // === Computed Properties ===

  /**
   * Determines if thinking budget UI should be visible
   * Requires model to support reasoning and have valid budget range
   */
  const showThinkingBudget = computed(() => {
    return (
      modelReasoning.value &&
      supportsReasoning.value === true &&
      !!budgetRange.value &&
      (budgetRange.value.min !== undefined ||
        budgetRange.value.max !== undefined ||
        budgetRange.value.default !== undefined)
    )
  })

  /**
   * Validates thinking budget value and returns error message if invalid
   * Handles special case for Gemini provider (-1 value)
   */
  const validationError = computed(() => {
    const value = thinkingBudget.value
    const range = budgetRange.value

    if (value === undefined || value === null || !range) {
      return ''
    }

    // Gemini special case: -1 is valid (unlimited)
    if (isGeminiProvider.value && value === -1) {
      return ''
    }

    // Check minimum boundary
    if (range.min !== undefined && value < range.min) {
      return t('settings.model.modelConfig.thinkingBudget.validation.minValue')
    }

    // Check maximum boundary
    if (range.max !== undefined && value > range.max) {
      return t('settings.model.modelConfig.thinkingBudget.validation.maxValue', { max: range.max })
    }

    return ''
  })

  // === Return Public API ===
  return {
    showThinkingBudget,
    validationError
  }
}
