import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import {
  downloadVerifiedFile,
  resetProbeCacheForTests,
  selectDownloadUrl
} from '../../../src/main/toolchains/downloader'
import { ToolchainDownloadError } from '../../../src/main/toolchains/errors'

function sha256(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

afterEach(() => {
  resetProbeCacheForTests()
})

describe('toolchain downloader', () => {
  it('resumes a partial file with Range and verifies sha256', async () => {
    const payload = Buffer.from('abcdefghijklmnopqrstuvwxyz')
    const destPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'dc-dl-')), 'archive.bin')
    writeFileSync(destPath, payload.subarray(0, 10))

    await downloadVerifiedFile({
      url: 'https://nodejs.org/dist/v24.18.0/node.tar.gz',
      destPath,
      sha256: sha256(payload),
      fetch: async (_url, init) => {
        expect((init?.headers as Record<string, string>).Range).toBe('bytes=10-')
        return new Response(payload.subarray(10), {
          status: 206,
          headers: { 'content-range': `bytes 10-25/26` }
        })
      }
    })

    expect(readFileSync(destPath)).toEqual(payload)
  })

  it('deletes a checksum mismatch instead of leaving a bad file', async () => {
    const destPath = path.join(mkdtempSync(path.join(os.tmpdir(), 'dc-dl-')), 'archive.bin')
    await expect(
      downloadVerifiedFile({
        url: 'https://example.test/node.tar.gz',
        destPath,
        sha256: '0'.repeat(64),
        fetch: async () => new Response(Buffer.from('nope'), { status: 200 })
      })
    ).rejects.toMatchObject({
      reason: 'checksum_mismatch'
    } satisfies Partial<ToolchainDownloadError>)

    expect(() => readFileSync(destPath)).toThrow()
  })

  it('uses official URL when a failed mirror probe is not cached as success', async () => {
    const official = 'https://nodejs.org/dist/v24.18.0/node.tar.gz'
    const mirror = 'https://mirror.example/node.tar.gz'
    const url = await selectDownloadUrl(
      official,
      async (candidate) => {
        if (candidate === mirror) return new Response(null, { status: 500 })
        return new Response(Buffer.from('x'), { status: 206 })
      },
      { mirrorUrl: mirror, allowProbe: true }
    )
    expect(url).toBe(official)
  })
})
