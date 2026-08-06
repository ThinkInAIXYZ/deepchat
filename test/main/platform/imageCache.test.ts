import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('fs/promises')
vi.unmock('node:fs/promises')
vi.unmock('path')
vi.unmock('node:path')

const electronMock = vi.hoisted(() => ({ userDataPath: '' }))
const axiosMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataPath)
  }
}))
vi.mock('axios', () => ({ default: axiosMock }))

import { cacheImage, resolveCachedImageDataUrl } from '@/platform/imageCache'

describe('imageCache', () => {
  const tempDirectories: string[] = []

  beforeEach(async () => {
    axiosMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    electronMock.userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-image-cache-'))
    tempDirectories.push(electronMock.userDataPath)
    await fs.mkdir(path.join(electronMock.userDataPath, 'images'))
  })

  afterEach(async () => {
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    )
    vi.mocked(console.error).mockRestore()
  })

  it('blocks a public image redirect to a private-network address', async () => {
    const sourceUrl = 'https://8.8.8.8/generated.png'
    axiosMock.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'http://127.0.0.1/private.png' },
      data: Buffer.alloc(0)
    })

    await expect(cacheImage(sourceUrl, { allowPrivateNetwork: false })).resolves.toBe(sourceUrl)

    expect(axiosMock).toHaveBeenCalledOnce()
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: false, lookup: expect.any(Function) })
    )
  })

  it('blocks private-network DNS answers for remote image URLs', async () => {
    const sourceUrl = 'http://localhost/generated.png'
    axiosMock.mockImplementationOnce(
      ({
        lookup,
        url
      }: {
        lookup: (hostname: string, options: object, callback: (error: Error | null) => void) => void
        url: string
      }) =>
        new Promise((resolve, reject) => {
          lookup(new URL(url).hostname, {}, (error: Error | null) => {
            if (error) reject(error)
            else resolve({ status: 200, headers: { 'content-type': 'image/png' }, data: 'image' })
          })
        })
    )

    await expect(cacheImage(sourceUrl, { allowPrivateNetwork: false })).resolves.toBe(sourceUrl)
    await expect(fs.readdir(path.join(electronMock.userDataPath, 'images'))).resolves.toEqual([])
  })

  it('bounds network responses and preserves supported MIME types', async () => {
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/avif' },
      data: Buffer.from('0000001866747970617669660000000061766966', 'hex')
    })

    const cached = await cacheImage('http://127.0.0.1/generated.avif', {
      allowPrivateNetwork: true
    })

    expect(cached).toMatch(/^imgcache:\/\/.+\.avif$/)
    expect(axiosMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 0,
        maxContentLength: 8 * 1024 * 1024,
        maxBodyLength: 8 * 1024 * 1024,
        signal: expect.any(AbortSignal)
      })
    )
    await expect(
      fs.readFile(
        path.join(electronMock.userDataPath, 'images', cached.slice('imgcache://'.length))
      )
    ).resolves.toEqual(Buffer.from('0000001866747970617669660000000061766966', 'hex'))
  })

  it('does not cache non-image HTTP responses', async () => {
    const sourceUrl = 'http://127.0.0.1/generated.png'
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/html' },
      data: Buffer.from('<html></html>')
    })

    await expect(cacheImage(sourceUrl, { allowPrivateNetwork: true })).resolves.toBe(sourceUrl)
    await expect(fs.readdir(path.join(electronMock.userDataPath, 'images'))).resolves.toEqual([])
  })

  it('does not cache HTTP responses above the image size limit', async () => {
    const sourceUrl = 'http://127.0.0.1/generated.png'
    axiosMock.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/png' },
      data: Buffer.alloc(8 * 1024 * 1024 + 1)
    })

    await expect(cacheImage(sourceUrl, { allowPrivateNetwork: true })).resolves.toBe(sourceUrl)
    await expect(fs.readdir(path.join(electronMock.userDataPath, 'images'))).resolves.toEqual([])
  })

  it('propagates caller cancellation to the active HTTP request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    axiosMock.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          requestSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    const caching = cacheImage('http://127.0.0.1/generated.png', {
      allowPrivateNetwork: true,
      signal: controller.signal
    })
    await vi.waitFor(() => expect(axiosMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(caching).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('resolves a cached image to a MIME-correct data URL', async () => {
    await fs.writeFile(path.join(electronMock.userDataPath, 'images', 'generated.png'), 'image')

    await expect(resolveCachedImageDataUrl('imgcache://generated.png')).resolves.toBe(
      'data:image/png;base64,aW1hZ2U='
    )
  })

  it('resolves cached images with an uppercase scheme', async () => {
    await fs.writeFile(path.join(electronMock.userDataPath, 'images', 'generated.png'), 'image')

    await expect(resolveCachedImageDataUrl('IMGCACHE://generated.png')).resolves.toBe(
      'data:image/png;base64,aW1hZ2U='
    )
  })

  it('rejects references outside the image cache root', async () => {
    await expect(resolveCachedImageDataUrl('imgcache://../outside.png')).rejects.toThrow(
      'Invalid cached image path'
    )
  })

  it('rejects symbolic links that escape the image cache root', async () => {
    const outsidePath = path.join(electronMock.userDataPath, 'outside.png')
    await fs.writeFile(outsidePath, 'image')
    await fs.symlink(
      outsidePath,
      path.join(electronMock.userDataPath, 'images', 'outside.png'),
      'file'
    )

    await expect(resolveCachedImageDataUrl('imgcache://outside.png')).rejects.toThrow(
      'Cached image reference is not a regular file'
    )
  })

  it('rejects missing cached images', async () => {
    await expect(resolveCachedImageDataUrl('imgcache://missing.png')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('rejects cached images above the MCP image input limit', async () => {
    await fs.writeFile(
      path.join(electronMock.userDataPath, 'images', 'oversized.png'),
      Buffer.alloc(8 * 1024 * 1024 + 1)
    )

    await expect(resolveCachedImageDataUrl('imgcache://oversized.png')).rejects.toThrow(
      'Cached image exceeds the MCP image input limit'
    )
  })

  it('rejects unsupported cached image types', async () => {
    await fs.writeFile(path.join(electronMock.userDataPath, 'images', 'generated.txt'), 'image')

    await expect(resolveCachedImageDataUrl('imgcache://generated.txt')).rejects.toThrow(
      'Unsupported cached image type'
    )
  })

  it('honors cancellation before reading the cached image', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolveCachedImageDataUrl('imgcache://generated.png', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
