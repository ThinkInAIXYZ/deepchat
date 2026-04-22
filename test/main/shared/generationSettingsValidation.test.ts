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
