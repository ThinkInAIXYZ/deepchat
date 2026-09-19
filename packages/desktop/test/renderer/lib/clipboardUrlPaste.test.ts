import { describe, expect, it, vi } from 'vitest'
import { extractPlainUrlFromClipboard, normalizeSingleHttpUrl } from '@/lib/clipboardUrlPaste'

function createClipboardData(data: Record<string, string>) {
  return {
    getData: vi.fn((format: string) => data[format] || '')
  }
}

describe('clipboardUrlPaste', () => {
  it('extracts a plain URL when rich HTML metadata is also present', () => {
    const clipboard = createClipboardData({
      'text/plain': 'https://example.com/a?b=1#c',
      'text/html': '<a href="https://example.com/a?b=1#c">Example title</a><p>Description</p>'
    })

    expect(extractPlainUrlFromClipboard(clipboard)).toBe('https://example.com/a?b=1#c')
  })

  it('extracts a single URL from text/uri-list when plain text is absent', () => {
    const clipboard = createClipboardData({
      'text/uri-list': '# copied from browser\nhttps://example.com/path\n'
    })

    expect(extractPlainUrlFromClipboard(clipboard)).toBe('https://example.com/path')
  })

  it('rejects title plus URL text', () => {
    expect(normalizeSingleHttpUrl('Example title\nhttps://example.com')).toBeNull()
  })

  it('rejects prose that contains a URL', () => {
    expect(normalizeSingleHttpUrl('visit https://example.com')).toBeNull()
  })

  it('rejects multiple URLs', () => {
    expect(normalizeSingleHttpUrl('https://example.com\nhttps://example.org')).toBeNull()
  })

  it('rejects unsupported schemes', () => {
    expect(normalizeSingleHttpUrl('mailto:hello@example.com')).toBeNull()
  })

  it('rejects leftover markup around a URL', () => {
    expect(normalizeSingleHttpUrl('https://example.com</a>')).toBeNull()
  })

  it('keeps invalid plain text from falling back to uri-list', () => {
    const clipboard = createClipboardData({
      'text/plain': 'Example title\nhttps://example.com',
      'text/uri-list': 'https://example.com'
    })

    expect(extractPlainUrlFromClipboard(clipboard)).toBeNull()
  })
})
