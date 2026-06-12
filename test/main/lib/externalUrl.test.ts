import { describe, expect, it, beforeEach, vi } from 'vitest'
import { shell } from 'electron'
import { isValidExternalUrl, normalizeExternalUrl } from '@shared/externalUrl'
import { openExternalUrl } from '@/lib/externalUrl'

describe('external URL validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows only approved external URL protocols', () => {
    expect(isValidExternalUrl('https://example.com')).toBe(true)
    expect(isValidExternalUrl('http://example.com')).toBe(true)
    expect(isValidExternalUrl('mailto:test@example.com')).toBe(true)
    expect(isValidExternalUrl('tel:+123456789')).toBe(true)
    expect(isValidExternalUrl('DEEPCHAT://provider/install')).toBe(true)

    expect(isValidExternalUrl('calculator://')).toBe(false)
    expect(isValidExternalUrl('smb://host/share')).toBe(false)
    expect(isValidExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isValidExternalUrl('not a url')).toBe(false)
  })

  it('normalizes whitespace before opening an allowed URL', () => {
    expect(normalizeExternalUrl('  https://example.com/docs  ')).toBe('https://example.com/docs')
  })

  it('blocks disallowed protocols before shell.openExternal', () => {
    expect(openExternalUrl('calculator://', 'test')).toBe(false)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('opens normalized allowed URLs through shell.openExternal', () => {
    expect(openExternalUrl('  https://example.com/docs  ', 'test')).toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })
})
