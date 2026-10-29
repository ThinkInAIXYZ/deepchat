import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clipboard, dialog, nativeImage, net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopImageActions } from '@/desktop/imageActions'

vi.unmock('fs')
vi.mock('electron', () => ({
  clipboard: { writeImage: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn(), createFromDataURL: vi.fn() },
  net: { fetch: vi.fn() }
}))

describe('DesktopImageActions', () => {
  let directory: string
  let images: DesktopImageActions
  const bytes = Buffer.from('image fixture')
  const source = `data:image/png;base64,${bytes.toString('base64')}`

  beforeEach(() => {
    vi.resetAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'deepchat-native-images-'))
    images = new DesktopImageActions(directory)
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it('writes the original bytes only to the path granted by the save dialog', async () => {
    const target = join(directory, 'chosen.png')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(images.saveImage({ source })).resolves.toEqual({ canceled: true })
    expect(existsSync(target)).toBe(false)

    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target })
    await expect(images.saveImage({ source, suggestedName: 'unsafe:name' })).resolves.toEqual({
      canceled: false,
      path: target
    })
    expect(readFileSync(target)).toEqual(bytes)
    expect(vi.mocked(dialog.showSaveDialog).mock.calls[1][0]).toMatchObject({
      defaultPath: 'unsafe_name.png'
    })
  })

  it('reads cached images inside the owned image directory and rejects path escapes', async () => {
    mkdirSync(join(directory, 'images'))
    writeFileSync(join(directory, 'images', 'cached image.png'), bytes)
    const target = join(directory, 'selected.png')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target })
    await images.saveImage({ source: 'imgcache://cached%20image.png' })
    expect(readFileSync(target)).toEqual(bytes)
    vi.mocked(dialog.showSaveDialog).mockClear()

    for (const source of ['imgcache://../outside.png', 'imgcache://%2e%2e/outside.png']) {
      await expect(images.saveImage({ source })).rejects.toThrow('Invalid cached image path')
    }
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('propagates native download errors before opening a dialog or writing the clipboard', async () => {
    vi.mocked(net.fetch).mockRejectedValueOnce(new Error('network unavailable'))
    await expect(images.copyImage({ source: 'https://example.test/image.png' })).rejects.toThrow(
      'network unavailable'
    )
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('denied', { status: 403 }))
    await expect(images.saveImage({ source: 'https://example.test/image.png' })).rejects.toThrow(
      'Failed to download image: 403'
    )
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })

  it('does not write the clipboard when native image decoding fails', async () => {
    const empty = { isEmpty: () => true } as Electron.NativeImage
    vi.mocked(nativeImage.createFromBuffer).mockReturnValue(empty)
    vi.mocked(nativeImage.createFromDataURL).mockReturnValue(empty)
    await expect(images.copyImage({ source })).rejects.toThrow(
      'Image data cannot be copied to clipboard'
    )
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })
})
