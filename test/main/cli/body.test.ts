import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBoundedJsonBody, parseBoundedJsonBytes, readBoundedRequestBody } from '@/cli/body'
import { CliRequestError } from '@/cli/errors'

const temporaryDirectories: string[] = []

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-body-'))
  temporaryDirectories.push(directory)
  return directory
}

function createRequest(
  chunks: Array<string | Buffer>,
  headers: Record<string, string> = {}
): IncomingMessage {
  const request = Readable.from(chunks)
  Object.defineProperties(request, {
    headers: { value: headers },
    headersDistinct: {
      value: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, [value]]))
    }
  })
  return request as IncomingMessage
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('bounded CLI request bodies', () => {
  it('keeps small bodies in memory without creating the spill directory', async () => {
    const root = await createTemporaryDirectory()
    const tempDirectory = path.join(root, 'spill')
    const request = createRequest(['{"value":', '42}'], { 'content-length': '12' })

    const body = await readBoundedRequestBody(request, {
      maxBytes: 64,
      memoryThresholdBytes: 32,
      tempDirectory,
      requireContentLength: true
    })

    expect(body).toMatchObject({ kind: 'memory', size: 12, sha256: sha256('{"value":42}') })
    expect(body.kind === 'memory' ? body.bytes.toString('utf8') : '').toBe('{"value":42}')
    await expect(stat(tempDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('spills large bodies to a private file and removes it idempotently', async () => {
    const root = await createTemporaryDirectory()
    const tempDirectory = path.join(root, 'spill')
    const request = createRequest(['12345', '67890'], { 'content-length': '10' })

    const body = await readBoundedRequestBody(request, {
      maxBytes: 16,
      memoryThresholdBytes: 4,
      tempDirectory,
      requireContentLength: true
    })

    expect(body.kind).toBe('file')
    if (body.kind !== 'file') throw new Error('Expected a spilled body')
    expect(await readFile(body.path, 'utf8')).toBe('1234567890')
    expect(body.sha256).toBe(sha256('1234567890'))
    if (process.platform !== 'win32') {
      expect((await stat(body.path)).mode & 0o777).toBe(0o600)
    }
    await body.cleanup()
    await body.cleanup()
    await expect(stat(body.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects cumulative overflow and removes a partial spill', async () => {
    const root = await createTemporaryDirectory()
    const tempDirectory = path.join(root, 'spill')
    const request = createRequest(['12345', '6789'])

    await expect(
      readBoundedRequestBody(request, {
        maxBytes: 8,
        memoryThresholdBytes: 4,
        tempDirectory,
        requireContentLength: false
      })
    ).rejects.toMatchObject<Partial<CliRequestError>>({ code: 'body_too_large', httpStatus: 413 })
    expect(await readdir(tempDirectory)).toEqual([])
  })

  it('requires an exact singular Content-Length for RPC requests', async () => {
    const root = await createTemporaryDirectory()
    const options = {
      maxBytes: 64,
      memoryThresholdBytes: 64,
      tempDirectory: path.join(root, 'spill'),
      requireContentLength: true
    }

    await expect(readBoundedRequestBody(createRequest(['{}']), options)).rejects.toMatchObject({
      code: 'invalid_request',
      httpStatus: 411
    })
    await expect(
      readBoundedRequestBody(createRequest(['{}'], { 'content-length': '3' }), options)
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('rejects unsafe JSON keys and always releases the body', async () => {
    const cleanup = vi.fn(async () => undefined)

    await expect(
      parseBoundedJsonBody({
        kind: 'memory',
        bytes: Buffer.from('{"nested":{"__proto__":true}}'),
        size: 31,
        sha256: sha256('{"nested":{"__proto__":true}}'),
        cleanup
      })
    ).rejects.toMatchObject({ code: 'invalid_request' })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('applies the same UTF-8 and shape limits to header JSON', () => {
    expect(parseBoundedJsonBytes(Buffer.from('{"value":42}'))).toEqual({ value: 42 })
    expect(() => parseBoundedJsonBytes(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: 'invalid_request' })
    )
    expect(() => parseBoundedJsonBytes(Buffer.from('{"constructor":true}'))).toThrowError(
      expect.objectContaining({ code: 'invalid_request' })
    )
  })
})
