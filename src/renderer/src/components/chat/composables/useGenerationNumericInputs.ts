import { ref, type Ref } from 'vue'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import type {
  GenerationNumericField,
  GenerationNumericValidationCode
} from '@shared/utils/generationSettingsValidation'

/**
 * Draft/error state machine shared by all generation numeric fields
 * (temperature, topP, contextLength, maxTokens, timeout, thinkingBudget).
 *
 * While a field is being edited (or holds a validation error) its draft value is
 * displayed; otherwise the committed value from `localSettings` is shown.
 */
export function useGenerationNumericInputs(options: {
  localSettings: Ref<SessionGenerationSettings | null>
  t: (key: string) => string
  /** Called whenever a draft value actually changes (drives persistence revision tracking) */
  onDraftChange: () => void
}) {
  const { localSettings, t, onDraftChange } = options

  const activeNumericInput = ref<GenerationNumericField | null>(null)
  const numericInputDrafts = ref<Record<GenerationNumericField, string>>({
    temperature: '',
    topP: '',
    contextLength: '',
    maxTokens: '',
    timeout: '',
    thinkingBudget: ''
  })
  const numericInputErrors = ref<
    Record<GenerationNumericField, GenerationNumericValidationCode | null>
  >({
    temperature: null,
    topP: null,
    contextLength: null,
    maxTokens: null,
    timeout: null,
    thinkingBudget: null
  })

  const getCommittedNumericInputValue = (field: GenerationNumericField): string => {
    if (!localSettings.value) {
      return ''
    }

    switch (field) {
      case 'temperature':
        return String(localSettings.value.temperature)
      case 'topP': {
        const value = localSettings.value.topP
        return value === undefined ? '' : String(value)
      }
      case 'contextLength':
        return String(localSettings.value.contextLength)
      case 'maxTokens':
        return String(localSettings.value.maxTokens)
      case 'timeout':
        return String(localSettings.value.timeout)
      case 'thinkingBudget': {
        const value = localSettings.value.thinkingBudget
        return value === undefined ? '' : String(value)
      }
    }
  }

  const syncNumericInputDraft = (field: GenerationNumericField): void => {
    numericInputDrafts.value[field] = getCommittedNumericInputValue(field)
  }

  const clearNumericInputError = (field: GenerationNumericField): void => {
    numericInputErrors.value[field] = null
  }

  const setNumericInputError = (
    field: GenerationNumericField,
    code: GenerationNumericValidationCode
  ): void => {
    numericInputErrors.value[field] = code
  }

  const resetNumericInputFieldState = (field: GenerationNumericField): void => {
    clearNumericInputError(field)
    syncNumericInputDraft(field)
  }

  const resetNumericInputState = (): void => {
    activeNumericInput.value = null
    resetNumericInputFieldState('temperature')
    resetNumericInputFieldState('topP')
    resetNumericInputFieldState('contextLength')
    resetNumericInputFieldState('maxTokens')
    resetNumericInputFieldState('timeout')
    resetNumericInputFieldState('thinkingBudget')
  }

  const hasNumericInputError = (field: GenerationNumericField): boolean =>
    numericInputErrors.value[field] !== null

  const startNumericInputEdit = (field: GenerationNumericField): void => {
    activeNumericInput.value = field
    if (!hasNumericInputError(field)) {
      syncNumericInputDraft(field)
    }
  }

  const setNumericInputDraft = (field: GenerationNumericField, value: string | number): void => {
    if (activeNumericInput.value !== field) {
      activeNumericInput.value = field
    }
    const nextValue = typeof value === 'string' ? value : String(value)
    if (numericInputDrafts.value[field] !== nextValue) {
      onDraftChange()
    }
    numericInputDrafts.value[field] = nextValue
    clearNumericInputError(field)
  }

  const stopNumericInputEdit = (field: GenerationNumericField): void => {
    if (activeNumericInput.value === field) {
      activeNumericInput.value = null
    }
  }

  const getNumericInputValue = (field: GenerationNumericField): string => {
    if (activeNumericInput.value === field || hasNumericInputError(field)) {
      return numericInputDrafts.value[field]
    }
    return getCommittedNumericInputValue(field)
  }

  const getNumericInputErrorMessage = (field: GenerationNumericField): string => {
    const code = numericInputErrors.value[field]
    if (!code) {
      return ''
    }

    switch (code) {
      case 'finite_number':
        return t('chat.advancedSettings.validation.finiteNumber')
      case 'non_negative_integer':
        return t('chat.advancedSettings.validation.nonNegativeInteger')
      case 'context_length_below_max_tokens':
        return t('chat.advancedSettings.validation.contextLengthAtLeastMaxTokens')
      case 'max_tokens_exceed_context_length':
        return t('chat.advancedSettings.validation.maxTokensWithinContextLength')
      case 'timeout_too_small':
        return t('settings.model.modelConfig.validation.timeoutMin')
      case 'timeout_too_large':
        return t('settings.model.modelConfig.validation.timeoutMax')
      case 'top_p_out_of_range':
        return t('chat.advancedSettings.validation.topPRange')
    }
  }

  return {
    activeNumericInput,
    numericInputDrafts,
    numericInputErrors,
    getCommittedNumericInputValue,
    syncNumericInputDraft,
    clearNumericInputError,
    setNumericInputError,
    resetNumericInputFieldState,
    resetNumericInputState,
    hasNumericInputError,
    startNumericInputEdit,
    setNumericInputDraft,
    stopNumericInputEdit,
    getNumericInputValue,
    getNumericInputErrorMessage
  }
}
