import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import fs from 'node:fs/promises'
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
    images = new DesktopImageActions(directory, (options) => dialog.showSaveDialog(options))
  })

  afterEach(() => {
    images.stop()
    vi.restoreAllMocks()
    rmSync(directory, { force: true, recursive: true })
  })

  it('writes the original bytes only to the path granted by the save dialog', async () => {
    const target = join(directory, 'chosen.png')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(images.saveImage({ source })).resolves.toEqual({ canceled: true })
    expect(existsSync(target)).toBe(false)

    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: target })
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const writeFile = fs.writeFile
    const write = vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      started.resolve()
      await release.promise
      await writeFile(...args)
    })
    const saving = images.saveImage({ source, suggestedName: 'unsafe:name' })
    try {
      await started.promise
      images.stop()
      release.resolve()
      await expect(saving).resolves.toEqual({ canceled: false, path: target })
    } finally {
      release.resolve()
      await saving.catch(() => {})
      write.mockRestore()
    }
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

  it('aborts downloads and denies late image effects after shutdown', async () => {
    const requested = Promise.withResolvers<AbortSignal | null | undefined>()
    const reading = Promise.withResolvers<void>()
    const body = Promise.withResolvers<ArrayBuffer>()
    const response = new Response(null, { headers: { 'content-type': 'image/png' } })
    vi.spyOn(response, 'arrayBuffer').mockImplementation(() => {
      reading.resolve()
      return body.promise
    })
    vi.mocked(net.fetch)
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            requested.resolve(options?.signal)
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
              once: true
            })
          })
      )
      .mockResolvedValueOnce(response)
    const saving = expect(
      images.saveImage({ source: 'https://example.test/headers.png' })
    ).rejects.toThrow('Native image actions are stopping')
    const copying = expect(
      images.copyImage({ source: 'https://example.test/body.png' })
    ).rejects.toThrow('Native image actions are stopping')
    const signal = await requested.promise
    await reading.promise
    images.stop()
    expect(signal?.aborted).toBe(true)
    body.resolve(Uint8Array.from(bytes).buffer)
    await Promise.all([saving, copying])
    await expect(images.copyImage({ source })).rejects.toThrow('Native image actions are stopping')
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(clipboard.writeImage).not.toHaveBeenCalled()
  })
})
