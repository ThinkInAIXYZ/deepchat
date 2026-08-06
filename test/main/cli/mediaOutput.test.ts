import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveGeneratedMedia } from '@/cli/mediaOutput'

const temporaryDirectories: string[] = []

async function createCacheDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-media-'))
  temporaryDirectories.push(directory)
  return directory
}

async function collect(data: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of data) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('generated media resolver', () => {
  it('strictly decodes raw base64 and matching data URLs', async () => {
    const directory = await createCacheDirectory()
    const raw = await resolveGeneratedMedia('aGVsbG8=', 'image/png', 'image', directory)
    const dataUrl = await resolveGeneratedMedia(
      'data:audio/ogg; codecs=opus;base64,aGVsbG8=',
      'audio/ogg; codecs=opus',
      'audio',
      directory
    )

    expect(await collect(raw.data)).toEqual(Buffer.from('hello'))
    expect(raw.mimeType).toBe('image/png')
    expect(await collect(dataUrl.data)).toEqual(Buffer.from('hello'))
    expect(dataUrl.mimeType).toBe('audio/ogg; codecs=opus')
  })

  it('rejects malformed, conflicting, cross-kind, and remote outputs', async () => {
    const directory = await createCacheDirectory()

    await expect(
      resolveGeneratedMedia('not base64', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      resolveGeneratedMedia('data:image/jpeg;base64,aGVsbG8=', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      resolveGeneratedMedia('aGVsbG8=', 'video/mp4', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      resolveGeneratedMedia('https://private.example/output.png', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })

    const invalidAlphabet = await resolveGeneratedMedia('abcd!===', 'image/png', 'image', directory)
    await expect(collect(invalidAlphabet.data)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('streams only regular files contained by the image cache', async () => {
    const directory = await createCacheDirectory()
    await writeFile(path.join(directory, 'generated.png'), 'cached-image')
    const resolved = await resolveGeneratedMedia(
      'imgcache://generated.png',
      'image/png',
      'image',
      directory
    )

    expect(await collect(resolved.data)).toEqual(Buffer.from('cached-image'))
    await resolved.dispose?.()
    await resolved.dispose?.()

    await expect(
      resolveGeneratedMedia('imgcache://%2e%2e%2foutside.png', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      resolveGeneratedMedia('imgcache://CON.png', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      resolveGeneratedMedia('imgcache://generated.png', 'image/png', 'video', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it.skipIf(process.platform === 'win32')('rejects symbolic links in the image cache', async () => {
    const root = await createCacheDirectory()
    const directory = path.join(root, 'images')
    await writeFile(path.join(root, 'target.png'), 'cached-image')
    await symlink(root, directory)

    await expect(
      resolveGeneratedMedia('imgcache://target.png', 'image/png', 'image', directory)
    ).rejects.toMatchObject({ code: 'unavailable' })

    await rm(directory)
    await writeFile(path.join(root, 'linked-target.png'), 'cached-image')
    await symlink(path.join(root, 'linked-target.png'), path.join(root, 'linked.png'))
    await expect(
      resolveGeneratedMedia('imgcache://linked.png', 'image/png', 'image', root)
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
})
