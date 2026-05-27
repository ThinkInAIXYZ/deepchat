import { describe, expect, it } from 'vitest'
import { MODEL_TIMEOUT_MAX_MS, MODEL_TIMEOUT_MIN_MS } from '../../../src/shared/modelConfigDefaults'
import { validateGenerationNumericField } from '../../../src/shared/utils/generationSettingsValidation'

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
