import { describe, expect, it } from 'vitest'
import { MODEL_TIMEOUT_MAX_MS, MODEL_TIMEOUT_MIN_MS } from '../../../src/shared/modelConfigDefaults'
import { validateGenerationNumericField } from '../../../src/shared/utils/generationSettingsValidation'

describe('validateGenerationNumericField thinking budget bounds', () => {
  it.each([
    [1023, 'thinking_budget_too_small'],
    [1024, null],
    [1300, null],
    [1301, 'thinking_budget_too_large'],
    [0, 'thinking_budget_too_small'],
    [1024.5, 'non_negative_integer'],
    [-1, 'non_negative_integer'],
    [Infinity, 'non_negative_integer']
  ])('validates %s against the declared range', (value, expected) => {
    expect(
      validateGenerationNumericField('thinkingBudget', value, {
        thinkingBudgetRange: { min: 1024, max: 1300 }
      })
    ).toBe(expected)
  })

  it('preserves declared non-negative sentinels and the no-range contract', () => {
    const context = { thinkingBudgetRange: { min: 1024, max: 1300, off: 0, auto: -1 } }
    expect(validateGenerationNumericField('thinkingBudget', '0', context)).toBeNull()
    // Negative legacy values still mean switch-off; they are not explicit session overrides.
    expect(validateGenerationNumericField('thinkingBudget', -1, context)).toBe(
      'non_negative_integer'
    )
    expect(validateGenerationNumericField('thinkingBudget', 999999)).toBeNull()
  })
})

describe('validateGenerationNumericField timeout bounds', () => {
  it('accepts timeout values within the supported range', () => {
    expect(validateGenerationNumericField('timeout', MODEL_TIMEOUT_MIN_MS)).toBeNull()
    expect(validateGenerationNumericField('timeout', MODEL_TIMEOUT_MAX_MS)).toBeNull()
  })

  it('rejects timeout values outside the supported range', () => {
    expect(validateGenerationNumericField('timeout', MODEL_TIMEOUT_MIN_MS - 1)).toBe(
      'timeout_too_small'
    )
    expect(validateGenerationNumericField('timeout', MODEL_TIMEOUT_MAX_MS + 1)).toBe(
      'timeout_too_large'
    )
  })
})

describe('validateGenerationNumericField topP bounds', () => {
  it('accepts finite topP values in the supported range', () => {
    expect(validateGenerationNumericField('topP', 0.1)).toBeNull()
    expect(validateGenerationNumericField('topP', 1)).toBeNull()
    expect(validateGenerationNumericField('topP', '0.5')).toBeNull()
  })

  it('rejects non-finite and out-of-range topP values', () => {
    expect(validateGenerationNumericField('topP', '')).toBe('finite_number')
    expect(validateGenerationNumericField('topP', Number.NaN)).toBe('finite_number')
    expect(validateGenerationNumericField('topP', 0)).toBe('top_p_out_of_range')
    expect(validateGenerationNumericField('topP', 0.01)).toBe('top_p_out_of_range')
    expect(validateGenerationNumericField('topP', -0.1)).toBe('top_p_out_of_range')
    expect(validateGenerationNumericField('topP', 1.01)).toBe('top_p_out_of_range')
  })
})

describe('validateGenerationNumericField context length bounds', () => {
  it('requires a positive context length', () => {
    expect(validateGenerationNumericField('contextLength', 0, { maxTokens: 0 })).toBe(
      'context_length_non_positive'
    )
    expect(validateGenerationNumericField('contextLength', 1, { maxTokens: 0 })).toBeNull()
  })
})
