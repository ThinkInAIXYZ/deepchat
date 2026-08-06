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

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataPath)
  }
}))

import { resolveCachedImageDataUrl } from '@/platform/imageCache'

describe('resolveCachedImageDataUrl', () => {
  const tempDirectories: string[] = []

  beforeEach(async () => {
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
