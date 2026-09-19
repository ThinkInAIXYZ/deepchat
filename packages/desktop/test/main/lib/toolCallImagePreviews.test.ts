import { describe, expect, it, vi } from 'vitest'
import {
  cacheToolCallImagePreviews,
  extractToolCallImagePreviews,
  prepareToolCallImageContent
} from '@/lib/toolCallImagePreviews'

describe('extractToolCallImagePreviews', () => {
  it('caches and normalizes an image URL embedded in MCP text content', async () => {
    const sourceUrl = 'https://example.com/output.jpeg?Expires=123&Signature=abc'
    const cacheImage = vi.fn(async () => 'imgcache://output.jpg')

    const prepared = await prepareToolCallImageContent({
      content: [
        { type: 'text', text: `Success. Image URL(s): ${sourceUrl}` },
        { type: 'text', text: `Reference: ${sourceUrl}` }
      ],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledOnce()
    expect(cacheImage).toHaveBeenCalledWith(sourceUrl, { signal: undefined })
    expect(prepared.content).toEqual([
      { type: 'text', text: 'Success. Image URL(s): imgcache://output.jpg' },
      { type: 'text', text: 'Reference: imgcache://output.jpg' }
    ])
    expect(prepared.imagePreviews).toEqual([
      {
        id: 'tool_output-1',
        data: 'imgcache://output.jpg',
        mimeType: 'image/jpeg',
        source: 'tool_output'
      }
    ])
  })

  it('preserves embedded image URLs when caching is not durable', async () => {
    const sourceUrl = 'https://example.com/output.png?Expires=123'
    const cacheImage = vi.fn(async () => sourceUrl)

    const prepared = await prepareToolCallImageContent({
      content: `Generated image: ${sourceUrl}`,
      cacheImage
    })

    expect(prepared.content).toBe(`Generated image: ${sourceUrl}`)
    expect(prepared.imagePreviews).toEqual([
      {
        id: 'tool_output-1',
        mimeType: 'image/png',
        source: 'tool_output'
      }
    ])
  })

  it('normalizes a signed image URL embedded in a string result', async () => {
    const sourceUrl = 'https://example.com/output.png?token=abc#preview'

    const prepared = await prepareToolCallImageContent({
      content: `Generated image: ${sourceUrl}. More details: https://example.com/result`,
      cacheImage: vi.fn().mockResolvedValue('imgcache://output.png')
    })

    expect(prepared.content).toBe(
      'Generated image: imgcache://output.png. More details: https://example.com/result'
    )
    expect(prepared.imagePreviews).toEqual([
      {
        id: 'tool_output-1',
        data: 'imgcache://output.png',
        mimeType: 'image/png',
        source: 'tool_output'
      }
    ])
  })

  it('replaces only complete extracted image URL tokens', async () => {
    const sourceUrl = 'https://example.com/output.png'
    const relatedUrl = `${sourceUrl}.json`

    const prepared = await prepareToolCallImageContent({
      content: `Image: ${sourceUrl} Metadata: ${relatedUrl}`,
      cacheImage: vi.fn().mockResolvedValue('imgcache://output.png')
    })

    expect(prepared.content).toBe(`Image: imgcache://output.png Metadata: ${relatedUrl}`)
  })

  it('caches at most four distinct images from one tool result', async () => {
    const sourceUrls = Array.from(
      { length: 5 },
      (_, index) => `https://example.com/output-${index + 1}.png`
    )
    const cacheImage = vi.fn(async (source: string) =>
      source.replace('https://example.com/', 'imgcache://')
    )

    const prepared = await prepareToolCallImageContent({
      content: sourceUrls.join('\n'),
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledTimes(4)
    expect(prepared.imagePreviews).toHaveLength(4)
    expect(prepared.content).toContain('imgcache://output-4.png')
    expect(prepared.content).toContain(sourceUrls[4])
  })

  it('extracts and caches MCP structured image output', async () => {
    const cacheImage = vi.fn(async () => 'imgcache://cached.png')

    const previews = await extractToolCallImagePreviews({
      toolName: 'draw',
      toolArgs: '{}',
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA', {
      signal: undefined
    })
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

    expect(cacheImage).toHaveBeenCalledWith('https://example.com/output.webp', {
      signal: undefined
    })
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

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA', {
      signal: undefined
    })
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

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA', {
      signal: undefined
    })
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

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA', {
      signal: undefined
    })
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

describe('cacheToolCallImagePreviews', () => {
  it('rewrites inline base64 previews to imgcache references', async () => {
    const cacheImage = vi.fn(async () => 'imgcache://cached.png')

    const previews = await cacheToolCallImagePreviews({
      imagePreviews: [
        {
          id: 'tool_output-1',
          data: 'data:image/png;base64,AAAA',
          mimeType: 'image/png',
          source: 'tool_output'
        }
      ],
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA', {
      signal: undefined
    })
    expect(previews).toEqual([
      {
        id: 'tool_output-1',
        data: 'imgcache://cached.png',
        mimeType: 'image/png',
        source: 'tool_output'
      }
    ])
  })

  it('leaves references and uncacheable previews unchanged', async () => {
    const cacheImage = vi.fn(async (data: string) => data)
    const input = [
      {
        id: 'tool_output-1',
        data: 'imgcache://already-cached.png',
        mimeType: 'image/png',
        source: 'tool_output' as const
      },
      {
        id: 'tool_output-2',
        data: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        source: 'tool_output' as const
      }
    ]

    const previews = await cacheToolCallImagePreviews({ imagePreviews: input, cacheImage })

    expect(cacheImage).toHaveBeenCalledOnce()
    expect(previews).toBe(input)
  })

  it('returns the input unchanged without a cacheImage function', async () => {
    const input = [
      {
        id: 'tool_output-1',
        data: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        source: 'tool_output' as const
      }
    ]

    await expect(cacheToolCallImagePreviews({ imagePreviews: input })).resolves.toBe(input)
  })

  it('normalizes an uppercase data URL prefix before caching', async () => {
    const cacheImage = vi.fn().mockResolvedValue('imgcache://cached.png')
    const input = [
      {
        id: 'tool_output-1',
        data: 'DATA:IMAGE/PNG;BASE64,QUFBQQ==',
        mimeType: 'image/png',
        source: 'tool_output' as const
      }
    ]

    const previews = await cacheToolCallImagePreviews({ imagePreviews: input, cacheImage })

    expect(cacheImage).toHaveBeenCalledWith('data:IMAGE/PNG;BASE64,QUFBQQ==', {
      signal: undefined
    })
    expect(previews).toEqual([{ ...input[0], data: 'imgcache://cached.png' }])
  })

  it('wraps and caches bare base64 previews', async () => {
    const cacheImage = vi.fn().mockResolvedValue('imgcache://cached.png')
    const input = [
      {
        id: 'tool_output-1',
        data: 'aGVsbG8=',
        mimeType: 'image/png',
        source: 'tool_output' as const
      }
    ]

    const previews = await cacheToolCallImagePreviews({ imagePreviews: input, cacheImage })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,aGVsbG8=', {
      signal: undefined
    })
    expect(previews).toEqual([{ ...input[0], data: 'imgcache://cached.png' }])
  })

  it.each([true, false])(
    'dedupes and caps inline previews when caching succeeds: %s',
    async (succeeds) => {
      const cacheImage = vi.fn(async (data: string) =>
        succeeds ? `imgcache://cached-${data.length}.png` : data
      )
      const duplicate = {
        id: 'tool_output-1',
        data: 'data:image/png;base64,QUFBQQ==',
        mimeType: 'image/png',
        source: 'tool_output' as const
      }
      const input = [
        duplicate,
        { ...duplicate, id: 'tool_output-dup' },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `tool_output-${index + 2}`,
          data: `data:image/png;base64,${'A'.repeat(index + 1)}`,
          mimeType: 'image/png',
          source: 'tool_output' as const
        }))
      ]

      const previews = await cacheToolCallImagePreviews({ imagePreviews: input, cacheImage })

      expect(cacheImage).toHaveBeenCalledTimes(4)
      expect(previews).toHaveLength(4)
      expect(previews.find((preview) => preview.id === 'tool_output-dup')).toBeUndefined()
      expect(
        previews.every((preview) =>
          preview.data?.startsWith(succeeds ? 'imgcache://' : 'data:image/')
        )
      ).toBe(true)
    }
  )

  it('drops duplicate cache results without restoring inline data', async () => {
    const previews = await cacheToolCallImagePreviews({
      imagePreviews: ['AAAA', 'BBBB'].map((data, index) => ({
        id: `image-${index}`,
        data: `data:image/png;base64,${data}`,
        mimeType: 'image/png',
        source: 'tool_output'
      })),
      cacheImage: async () => 'imgcache://same.png'
    })

    expect(previews).toHaveLength(1)
    expect(previews[0].data).toBe('imgcache://same.png')
  })
})
