import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactSpool } from '@/cli/artifactSpool'
import type { AgentCliRouteCaller, HumanCliRouteCaller } from '@/routes/routeRegistry'

const spools: ArtifactSpool[] = []
const temporaryDirectories: string[] = []

const humanCaller: HumanCliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'human-connection',
  scopes: ['artifacts:read', 'artifacts:manage']
}

const agentCaller = (conversationId: string): AgentCliRouteCaller => ({
  kind: 'cli',
  principal: 'agent',
  connectionId: `agent-${conversationId}`,
  tokenId: `token-id-${conversationId}`,
  conversationId,
  expiresAt: Date.now() + 60_000,
  scopes: ['artifacts:read']
})

async function createSpool(
  options: Omit<ConstructorParameters<typeof ArtifactSpool>[0], 'directory'> = {}
): Promise<{ spool: ArtifactSpool; directory: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-artifact-spool-'))
  temporaryDirectories.push(root)
  const directory = path.join(root, 'artifacts')
  const spool = new ArtifactSpool({ directory, consumeAgentBytes: () => true, ...options })
  spools.push(spool)
  return { spool, directory }
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

afterEach(async () => {
  await Promise.allSettled(spools.splice(0).map((spool) => spool.close()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('ArtifactSpool', () => {
  it('publishes private metadata and bytes without exposing a path', async () => {
    const { spool, directory } = await createSpool()
    const metadata = await spool.write({
      caller: humanCaller,
      requestId: 'request-1',
      mimeType: 'audio/ogg; codecs=opus',
      suggestedFilename: '../voice.ogg',
      data: Buffer.from('generated-audio')
    })

    expect(metadata).toMatchObject({
      owner: 'human',
      mimeType: 'audio/ogg; codecs=opus',
      filename: '.._voice.ogg',
      size: 15
    })
    expect(metadata).not.toHaveProperty('path')
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
    }

    const opened = await spool.openRead(metadata.id, humanCaller)
    expect(await collect(opened.stream)).toEqual(Buffer.from('generated-audio'))
    expect(await readFile(path.join(directory, `${metadata.id}.artifact`), 'utf8')).toBe(
      'generated-audio'
    )
  })

  it('streams writes while hashing and accounting the complete result', async () => {
    const { spool } = await createSpool()
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('generated-')
      yield new Uint8Array()
      yield Buffer.from('video')
    }

    const metadata = await spool.write({
      caller: humanCaller,
      requestId: 'request-stream',
      mimeType: 'video/mp4',
      data: chunks()
    })

    expect(metadata).toMatchObject({ size: 15, filename: 'artifact.mp4' })
    const opened = await spool.openRead(metadata.id, humanCaller)
    expect(await collect(opened.stream)).toEqual(Buffer.from('generated-video'))
  })

  it('removes partial output and releases quota when a write is cancelled', async () => {
    const { spool, directory } = await createSpool({
      limits: {
        maxArtifactBytes: 8,
        maxRequestBytes: 8,
        maxConnectionBytes: 8,
        maxOwnerBytes: 8,
        maxTotalBytes: 8
      }
    })
    const controller = new AbortController()
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('part')
      controller.abort()
      yield Buffer.from('more')
    }

    await expect(
      spool.write({
        caller: humanCaller,
        requestId: 'request-cancelled',
        mimeType: 'application/octet-stream',
        data: chunks(),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(await readdir(directory)).toEqual([])

    await expect(
      spool.write({
        caller: humanCaller,
        requestId: 'request-after-cancel',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(8)
      })
    ).resolves.toMatchObject({ size: 8 })
  })

  it('isolates Agent artifacts by conversation while allowing human recovery', async () => {
    const { spool } = await createSpool()
    const owner = agentCaller('conversation-a')
    const metadata = await spool.write({
      caller: owner,
      requestId: 'request-1',
      mimeType: 'image/png',
      data: Buffer.from('png')
    })

    await expect(spool.describe(metadata.id, owner)).resolves.toEqual(metadata)
    await expect(spool.describe(metadata.id, agentCaller('conversation-b'))).rejects.toMatchObject({
      code: 'permission_denied'
    })
    await expect(spool.describe(metadata.id, humanCaller)).resolves.toEqual(metadata)
  })

  it('stops and removes an Agent artifact when its token byte quota is exhausted', async () => {
    let remainingBytes = 5
    const { spool, directory } = await createSpool({
      consumeAgentBytes: (_tokenId, bytes) => {
        if (bytes > remainingBytes) return false
        remainingBytes -= bytes
        return true
      }
    })
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('1234')
      yield Buffer.from('5678')
    }

    await expect(
      spool.write({
        caller: agentCaller('conversation-a'),
        requestId: 'request-quota',
        mimeType: 'application/octet-stream',
        data: chunks()
      })
    ).rejects.toMatchObject({ code: 'rate_limited' })
    expect(await readdir(directory)).toEqual([])
  })

  it('accounts in-flight writes before enforcing aggregate quotas', async () => {
    const { spool } = await createSpool({
      limits: {
        maxArtifactBytes: 8,
        maxOwnerBytes: 10,
        maxTotalBytes: 10,
        maxOwnerCount: 2,
        maxTotalCount: 2
      }
    })

    const writes = await Promise.allSettled([
      spool.write({
        caller: humanCaller,
        requestId: 'request-1',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(6, 1)
      }),
      spool.write({
        caller: humanCaller,
        requestId: 'request-2',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(6, 2)
      })
    ])

    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(writes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'rate_limited' }
    })
  })

  it('enforces request and connection quotas independently', async () => {
    const { spool } = await createSpool({
      limits: {
        maxArtifactBytes: 8,
        maxRequestBytes: 8,
        maxConnectionBytes: 12,
        maxOwnerBytes: 32,
        maxTotalBytes: 32,
        maxRequestCount: 2,
        maxConnectionCount: 4,
        maxOwnerCount: 8,
        maxTotalCount: 8
      }
    })
    await spool.write({
      caller: humanCaller,
      requestId: 'request-1',
      mimeType: 'application/octet-stream',
      data: Buffer.alloc(6)
    })

    await expect(
      spool.write({
        caller: humanCaller,
        requestId: 'request-1',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(3)
      })
    ).rejects.toMatchObject({ code: 'rate_limited' })
    await spool.write({
      caller: humanCaller,
      requestId: 'request-2',
      mimeType: 'application/octet-stream',
      data: Buffer.alloc(6)
    })
    await expect(
      spool.write({
        caller: humanCaller,
        requestId: 'request-3',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(1)
      })
    ).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('releases committed quota after removing an artifact', async () => {
    const { spool } = await createSpool({
      limits: {
        maxArtifactBytes: 6,
        maxRequestBytes: 6,
        maxConnectionBytes: 6,
        maxOwnerBytes: 6,
        maxTotalBytes: 6,
        maxRequestCount: 1,
        maxConnectionCount: 1,
        maxOwnerCount: 1,
        maxTotalCount: 1
      }
    })
    const first = await spool.write({
      caller: humanCaller,
      requestId: 'request-before-removal',
      mimeType: 'application/octet-stream',
      data: Buffer.alloc(6)
    })

    await spool.discard(first.id)

    await expect(
      spool.write({
        caller: humanCaller,
        requestId: 'request-after-removal',
        mimeType: 'application/octet-stream',
        data: Buffer.alloc(6)
      })
    ).resolves.toMatchObject({ size: 6 })
  })

  it('expires artifacts and removes their files', async () => {
    let now = 1_000
    const { spool, directory } = await createSpool({ now: () => now })
    const metadata = await spool.write({
      caller: humanCaller,
      requestId: 'request-1',
      mimeType: 'text/plain',
      data: Buffer.from('temporary'),
      ttlMs: 10
    })

    now = 1_011
    await expect(spool.describe(metadata.id, humanCaller)).rejects.toMatchObject({
      code: 'not_found'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps active downloads stable and rejects concurrent deletion', async () => {
    const { spool } = await createSpool()
    const metadata = await spool.write({
      caller: humanCaller,
      requestId: 'request-1',
      mimeType: 'application/octet-stream',
      data: Buffer.alloc(64 * 1024, 1)
    })
    const opened = await spool.openRead(metadata.id, humanCaller)

    await expect(spool.delete(metadata.id, humanCaller)).rejects.toMatchObject({
      code: 'conflict',
      retriable: true
    })
    expect(await collect(opened.stream)).toHaveLength(metadata.size)
    await expect(spool.delete(metadata.id, humanCaller)).resolves.toBeUndefined()
    await expect(spool.describe(metadata.id, humanCaller)).rejects.toMatchObject({
      code: 'not_found'
    })
  })

  it('leases an owned file for domain input without exposing its path in metadata', async () => {
    const { spool } = await createSpool()
    const owner = agentCaller('conversation-a')
    const metadata = await spool.write({
      caller: owner,
      requestId: 'request-input',
      mimeType: 'audio/wav',
      data: Buffer.from('audio-input')
    })

    const bytes = await spool.withFile(metadata.id, owner, async (file) => {
      expect(file.metadata).not.toHaveProperty('path')
      await expect(spool.delete(metadata.id, humanCaller)).rejects.toMatchObject({
        code: 'conflict'
      })
      return await readFile(file.path)
    })

    expect(bytes).toEqual(Buffer.from('audio-input'))
    await expect(
      spool.withFile(metadata.id, agentCaller('conversation-b'), async () => undefined)
    ).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(spool.delete(metadata.id, humanCaller)).resolves.toBeUndefined()
  })

  it('defers internal discard until active reads finish and blocks new readers', async () => {
    const { spool, directory } = await createSpool()
    const metadata = await spool.write({
      caller: humanCaller,
      requestId: 'request-discard',
      mimeType: 'application/octet-stream',
      data: Buffer.alloc(64 * 1024, 1)
    })
    const opened = await spool.openRead(metadata.id, humanCaller)

    await expect(spool.discard(metadata.id)).resolves.toBeUndefined()
    await expect(spool.openRead(metadata.id, humanCaller)).rejects.toMatchObject({
      code: 'not_found'
    })
    expect(await collect(opened.stream)).toHaveLength(metadata.size)
    await expect.poll(async () => readdir(directory)).toEqual([])
  })

  it('cleans only spool-owned crash remnants during initialization', async () => {
    const { spool, directory } = await createSpool()
    await writeFile(path.join(path.dirname(directory), 'keep.txt'), 'outside')
    await spool.initialize()
    await writeFile(path.join(directory, '.abcdefghijklmnop.tmp'), 'partial')
    await writeFile(path.join(directory, 'abcdefghijklmnop.artifact'), 'stale')
    await writeFile(path.join(directory, 'keep.txt'), 'foreign')
    await spool.close()

    const replacement = new ArtifactSpool({ directory })
    spools.push(replacement)
    await replacement.initialize()

    expect(await readdir(directory)).toEqual(['keep.txt'])
    expect(await readFile(path.join(path.dirname(directory), 'keep.txt'), 'utf8')).toBe('outside')
  })
})
