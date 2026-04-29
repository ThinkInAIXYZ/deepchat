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

  it('extracts CDP screenshot output from Page.captureScreenshot', async () => {
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
        data: 'data:image/jpeg;base64,BBBB',
        mimeType: 'image/jpeg',
        title: 'Page.captureScreenshot',
        source: 'screenshot'
      }
    ])
  })

  it('extracts explicit image references from JSON output', async () => {
    const previews = await extractToolCallImagePreviews({
      content: JSON.stringify({
        result: {
          imageUrl: 'https://example.com/output.webp'
        }
      })
    })

    expect(previews).toEqual([
      {
        id: 'tool_output-1',
        data: 'https://example.com/output.webp',
        mimeType: 'image/webp',
        source: 'tool_output'
      }
    ])
  })
})
