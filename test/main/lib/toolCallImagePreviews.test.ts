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

  it('drops CDP screenshot preview when image caching is unavailable', async () => {
    const previews = await extractToolCallImagePreviews({
      toolName: 'cdp_send',
      toolArgs: JSON.stringify({
        method: 'Page.captureScreenshot',
        params: { format: 'jpeg' }
      }),
      content: JSON.stringify({ data: 'BBBB' })
    })

    expect(previews).toEqual([])
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

  it('drops previews when image caching fails', async () => {
    const cacheImage = vi.fn(async () => {
      throw new Error('cache failed')
    })

    const previews = await extractToolCallImagePreviews({
      content: 'data:image/png;base64,AAAA',
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([])
  })

  it('drops previews when image caching returns the original data URL', async () => {
    const cacheImage = vi.fn(async (data: string) => data)

    const previews = await extractToolCallImagePreviews({
      content: 'data:image/png;base64,AAAA',
      cacheImage
    })

    expect(cacheImage).toHaveBeenCalledWith('data:image/png;base64,AAAA')
    expect(previews).toEqual([])
  })
})
