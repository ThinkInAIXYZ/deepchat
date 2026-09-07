import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSkillArchive } from '@/skill/archiveDownload'

const temporaryDirectories: string[] = []

async function temporaryDestination(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-skill-download-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'skill.zip')
}

function streamingResponse(
  chunks: readonly string[],
  headers: Record<string, string> = {}
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Buffer.from(chunk))
        controller.close()
      }
    }),
    { status: 200, headers: { 'content-type': 'application/zip', ...headers } }
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('Skill archive download', () => {
  it('streams a bounded archive directly to a private destination', async () => {
    const destination = await temporaryDestination()
    const fetchImpl = vi.fn(async () =>
      streamingResponse(['zip-', 'bytes'], { 'content-length': '9' })
    )

    await downloadSkillArchive('https://skills.example/archive.zip', destination, {
      maxBytes: 16,
      timeoutMs: 5_000,
      fetchImpl
    })

    expect(await readFile(destination, 'utf8')).toBe('zip-bytes')
    if (process.platform !== 'win32') {
      expect((await stat(destination)).mode & 0o777).toBe(0o600)
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://skills.example/archive.zip'),
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('enforces the cumulative byte limit and removes partial downloads', async () => {
    const destination = await temporaryDestination()

    await expect(
      downloadSkillArchive('https://skills.example/archive.zip', destination, {
        maxBytes: 8,
        timeoutMs: 5_000,
        fetchImpl: async () => streamingResponse(['12345', '6789'])
      })
    ).rejects.toThrow('8-byte download limit')
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects invalid or oversized declared lengths before creating a file', async () => {
    const invalidDestination = await temporaryDestination()
    const oversizedDestination = await temporaryDestination()

    await expect(
      downloadSkillArchive('https://skills.example/invalid.zip', invalidDestination, {
        maxBytes: 8,
        timeoutMs: 5_000,
        fetchImpl: async () => streamingResponse(['zip'], { 'content-length': '1e3' })
      })
    ).rejects.toThrow('Content-Length is invalid')
    await expect(
      downloadSkillArchive('https://skills.example/large.zip', oversizedDestination, {
        maxBytes: 8,
        timeoutMs: 5_000,
        fetchImpl: async () => streamingResponse(['zip'], { 'content-length': '9' })
      })
    ).rejects.toThrow('8-byte download limit')
    await expect(stat(invalidDestination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(oversizedDestination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('follows bounded redirects without permitting an HTTPS downgrade', async () => {
    const destination = await temporaryDestination()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/skill.zip' }
        })
      )
      .mockResolvedValueOnce(streamingResponse(['zip']))

    await downloadSkillArchive('https://skills.example/archive.zip', destination, {
      maxBytes: 8,
      timeoutMs: 5_000,
      fetchImpl
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const downgradeDestination = await temporaryDestination()
    await expect(
      downloadSkillArchive('https://skills.example/archive.zip', downgradeDestination, {
        maxBytes: 8,
        timeoutMs: 5_000,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://cdn.example/skill.zip' }
          })
      })
    ).rejects.toThrow('HTTPS downgrade')
    await expect(stat(downgradeDestination)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
