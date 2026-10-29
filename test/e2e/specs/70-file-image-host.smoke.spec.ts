import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type ImageActionFixture = {
  target?: string
  dialogs: string[]
  copied: { width: number; height: number }[]
  restore(): void
}

test.use({ privacyModeEnabled: true })

test('file preparation and native image actions preserve bytes and profile bounds @smoke', async ({
  launchApp
}) => {
  const png = await sharp({
    create: { width: 32, height: 24, channels: 4, background: '#2c8651' }
  })
    .png()
    .toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(png)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Image fixture did not listen')
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    active = await launchApp({
      prepareUserData(profile) {
        mkdirSync(join(profile, 'images'), { recursive: true })
        writeFileSync(join(profile, 'images', 'cached image.png'), png)
        writeFileSync(join(profile, 'note.txt'), 'file preparation fixture')
      }
    })
    await waitForAppReady(active.page)
    expect(active.ownsUserDataDir).toBe(true)
    const profile = active.userDataDir
    const prepared = await active.page.evaluate(
      ({ textPath, imagePath, dataUrl }) =>
        Promise.all([
          window.deepchat.invoke('file.prepareFile', { path: textPath }),
          window.deepchat.invoke('file.prepareFile', { path: imagePath }),
          window.deepchat.invoke('file.readFile', { path: 'note.txt' }),
          window.deepchat.invoke('file.writeImageBase64', {
            name: '../../outside.png',
            content: dataUrl
          })
        ]),
      {
        textPath: join(profile, 'note.txt'),
        imagePath: join(profile, 'images', 'cached image.png'),
        dataUrl
      }
    )
    expect(prepared[0].file.content).toContain('file preparation fixture')
    expect(prepared[1].file.mimeType).toBe('image/png')
    expect(prepared[1].file.thumbnail).toMatch(/^data:image\/jpeg;base64,/)
    expect(prepared[2]).toEqual({ content: 'file preparation fixture' })
    expect(dirname(prepared[3].path)).toBe(join(profile, 'temp'))
    expect(readFileSync(prepared[3].path)).toEqual(png)
    await expect(
      active.page.evaluate(() =>
        window.deepchat.invoke('file.readFile', { path: '../outside.txt' })
      )
    ).rejects.toThrow('File path escapes user data directory')

    // Keep real native decoding and filesystem writes while owning dialog and clipboard effects.
    await active.electronApp.evaluate(({ clipboard, dialog }) => {
      const save = dialog.showSaveDialog
      const copy = clipboard.writeImage
      const fixture: ImageActionFixture = {
        dialogs: [],
        copied: [],
        restore() {
          dialog.showSaveDialog = save
          clipboard.writeImage = copy
        }
      }
      dialog.showSaveDialog = async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions
        fixture.dialogs.push(options.defaultPath ?? '')
        return { canceled: !fixture.target, filePath: fixture.target ?? '' }
      }
      clipboard.writeImage = (image) => {
        fixture.copied.push(image.getSize())
      }
      ;(
        globalThis as typeof globalThis & { imageActionFixture: ImageActionFixture }
      ).imageActionFixture = fixture
    })
    const sources = [
      { source: dataUrl },
      { source: png.toString('base64'), mimeType: 'image/png' },
      { source: 'imgcache://cached%20image.png' },
      { source: `http://127.0.0.1:${address.port}/remote.png` }
    ]
    for (const [index, source] of sources.entries()) {
      const target = join(profile, `saved-${index}.png`)
      await active.electronApp.evaluate((_, target) => {
        ;(
          globalThis as typeof globalThis & { imageActionFixture: ImageActionFixture }
        ).imageActionFixture.target = target
      }, target)
      expect(
        await active.page.evaluate((input) => window.deepchat.invoke('file.saveImage', input), {
          ...source,
          suggestedName: 'saved:image'
        })
      ).toEqual({ canceled: false, path: target })
      expect(readFileSync(target)).toEqual(png)
      expect(
        await active.page.evaluate(
          (input) => window.deepchat.invoke('file.copyImage', input),
          source
        )
      ).toEqual({ copied: true })
    }
    await active.electronApp.evaluate(() => {
      ;(
        globalThis as typeof globalThis & { imageActionFixture: ImageActionFixture }
      ).imageActionFixture.target = undefined
    })
    expect(
      await active.page.evaluate(
        (source) => window.deepchat.invoke('file.saveImage', { source }),
        dataUrl
      )
    ).toEqual({ canceled: true })
    await expect(
      active.page.evaluate(() =>
        window.deepchat.invoke('file.copyImage', {
          source: 'bm90IGFuIGltYWdl',
          mimeType: 'image/png'
        })
      )
    ).rejects.toThrow('Image data cannot be copied to clipboard')
    const observed = await active.electronApp.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { imageActionFixture: ImageActionFixture })
        .imageActionFixture
      return { dialogs: fixture.dialogs, copied: fixture.copied }
    })
    expect(observed.dialogs.slice(0, 4)).toEqual(Array(4).fill('saved_image.png'))
    expect(observed.copied).toEqual(Array(4).fill({ width: 32, height: 24 }))
    await active.electronApp.evaluate(() => {
      ;(
        globalThis as typeof globalThis & { imageActionFixture: ImageActionFixture }
      ).imageActionFixture.restore()
    })
    expect(await active.close()).toBe('graceful')
    active = await launchApp()
    await waitForAppReady(active.page)
    expect(
      await active.page.evaluate(() =>
        window.deepchat.invoke('file.readFile', { path: 'note.txt' })
      )
    ).toEqual({ content: 'file preparation fixture' })
    expect(await active.close()).toBe('graceful')
  } finally {
    if (active) {
      await active.electronApp
        .evaluate(() => {
          ;(
            globalThis as typeof globalThis & { imageActionFixture?: ImageActionFixture }
          ).imageActionFixture?.restore()
        })
        .catch(() => {})
      await active.close()
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
