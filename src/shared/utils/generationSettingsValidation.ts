import type { SessionGenerationSettings } from '../types/agent-interface'

export type GenerationNumericField =
  | 'temperature'
  | 'contextLength'
  | 'maxTokens'
  | 'thinkingBudget'

export type GenerationNumericValidationCode =
  | 'finite_number'
  | 'non_negative_integer'
  | 'context_length_below_max_tokens'
  | 'max_tokens_exceed_context_length'

type GenerationRelationContext = Pick<SessionGenerationSettings, 'contextLength' | 'maxTokens'>

export const parseFiniteNumericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : undefined
}

export const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0

export const toValidNonNegativeInteger = (value: unknown): number | undefined => {
  const numeric = parseFiniteNumericValue(value)
  return isNonNegativeInteger(numeric) ? numeric : undefined
}

export const normalizeLegacyThinkingBudgetValue = (value: unknown): number | undefined =>
  toValidNonNegativeInteger(value)

export const validateGenerationNumericField = (
  field: GenerationNumericField,
  value: unknown,
  context: Partial<GenerationRelationContext> = {}
): GenerationNumericValidationCode | null => {
  const numeric = parseFiniteNumericValue(value)

  if (field === 'temperature') {
    return numeric === undefined ? 'finite_number' : null
  }

  if (!isNonNegativeInteger(numeric)) {
    return 'non_negative_integer'
  }

  if (field === 'contextLength') {
    const maxTokens = context.maxTokens
    if (isNonNegativeInteger(maxTokens) && numeric < maxTokens) {
      return 'context_length_below_max_tokens'
    }
  }

  if (field === 'maxTokens') {
    const contextLength = context.contextLength
    if (isNonNegativeInteger(contextLength) && numeric > contextLength) {
      return 'max_tokens_exceed_context_length'
    }
  }

  return null
}
