import { describe, expect, it } from 'vitest'
import { isHardlinkUnavailableError } from '@shared/utils/filesystem'

describe('filesystem utilities', () => {
  it('recognizes hardlink capability errors without assuming an Error object', () => {
    expect(isHardlinkUnavailableError(null)).toBe(false)
    expect(isHardlinkUnavailableError(undefined)).toBe(false)
    expect(isHardlinkUnavailableError('EPERM')).toBe(false)
    expect(
      isHardlinkUnavailableError(Object.assign(new Error('unsupported'), { code: 'EPERM' }))
    ).toBe(true)
    expect(isHardlinkUnavailableError({ code: 'EPERM' })).toBe(true)
    expect(
      isHardlinkUnavailableError(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    ).toBe(false)
  })
})
