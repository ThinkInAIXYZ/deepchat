import { describe, expect, it, vi } from 'vitest'
import { extractToolCallImagePreviews } from '@/lib/toolCallImagePreviews'

describe('extractToolCallImagePreviews', () => {
  it('extracts and caches MCP structured image output', async () => {
    const cacheImage = vi.fn(async () => 'imgcache://cached.png')

    const previews = await extractToolCallImagePreviews({
      toolName: 'draw',
      toolArgs: '{}',
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([
      {
        id: 'mcp_image-1',
        data: 'imgcache://cached.png',
        mimeType: 'image/png',
        source: 'mcp_image'
      }
    ])
  })

  it('preserves CDP screenshot metadata when image caching is unavailable', async () => {
    const previews = await extractToolCallImagePreviews({
      toolName: 'cdp_send',
      toolArgs: JSON.stringify({
        method: 'Page.captureScreenshot',
        params: { format: 'jpeg' }
      }),
      content: JSON.stringify({ data: 'BBBB' })
    })

    expect(previews).toEqual([
      {
        id: 'screenshot-1',
        mimeType: 'image/jpeg',
        title: 'Page.captureScreenshot',
        source: 'screenshot'
      }
    ])
  })

  it('extracts explicit image references from JSON output', async () => {
    const cacheImage = vi.fn(async () => 'imgcache://output.webp')

    const previews = await extractToolCallImagePreviews({
      content: JSON.stringify({
        result: {
          imageUrl: 'https://example.com/output.webp'
        }
      }),
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('https://example.com/output.webp')
    expect(previews).toEqual([
      {
        id: 'tool_output-1',
        data: 'imgcache://output.webp',
        mimeType: 'image/webp',
        source: 'tool_output'
      }
    ])
  })

  it('preserves preview metadata when image caching fails', async () => {
    const cacheImage = vi.fn(async () => {
      throw new Error('cache failed')
    })

    const previews = await extractToolCallImagePreviews({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([
      {
        id: 'mcp_image-1',
        mimeType: 'image/png',
        source: 'mcp_image'
      }
    ])
  })

  it('preserves preview metadata when image caching returns the original data URL', async () => {
    const cacheImage = vi.fn(async (data: string) => data)

    const previews = await extractToolCallImagePreviews({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([
      {
        id: 'mcp_image-1',
        mimeType: 'image/png',
        source: 'mcp_image'
      }
    ])
  })

  it('preserves preview metadata when image caching returns a normalized data URL', async () => {
    const cacheImage = vi.fn(async () => '  DATA:IMAGE/PNG;base64,AAAA  ')

    const previews = await extractToolCallImagePreviews({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([
      {
        id: 'mcp_image-1',
        mimeType: 'image/png',
        source: 'mcp_image'
      }
    ])
  })

  it('does not start image caching when already cancelled', async () => {
    const cacheImage = vi.fn(async () => 'imgcache://should-not-run.png')
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      extractToolCallImagePreviews({
        content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
        cacheImage,
        signal: abortController.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(cacheImage).not.toHaveBeenCalled()
  })

  it('rejects promptly when cancellation lands during image caching', async () => {
    const cacheImage = vi.fn(() => new Promise<string>(() => {}))
    const abortController = new AbortController()

    const extracting = extractToolCallImagePreviews({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage,
      signal: abortController.signal
    })
    await vi.waitFor(() => expect(cacheImage).toHaveBeenCalledOnce())

    abortController.abort()

    await expect(extracting).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('observes a late cache failure when caching synchronously cancels', async () => {
    let rejectCache!: (reason?: unknown) => void
    const cachePromise = new Promise<string>((_, reject) => {
      rejectCache = reject
    })
    const abortController = new AbortController()
    const lateError = new Error('late cache failure')
    const unhandled = vi.fn()
    const cacheImage = vi.fn(() => {
      abortController.abort()
      return cachePromise
    })

    await expect(
      extractToolCallImagePreviews({
        content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
        cacheImage,
        signal: abortController.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    process.on('unhandledRejection', unhandled)
    try {
      rejectCache(lateError)
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled.mock.calls.some(([reason]) => reason === lateError)).toBe(false)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
