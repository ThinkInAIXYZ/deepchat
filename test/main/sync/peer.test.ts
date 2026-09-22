import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')

import { SyncHostService } from '@/sync/host'
import { SyncPeerService } from '@/sync/peer'
import { createSyncPeerRoutes } from '@/sync/peer/routes'
import { SyncHostSnapshotSource } from '@/sync/host/snapshot'

/** Real host/client sockets and private profiles; only OS crypto and final database import are ports. */
describe('tunnel sync transfer boundary', () => {
  let root: string
  let host: SyncHostService
  let peer: SyncPeerService
  let hostOrigin: string
  let bytes: Buffer
  let fileName: string
  let imported: Buffer[]
  let requestFetch: typeof fetch
  let requests: Array<{ path: string; range: string | null }>
  let exportFailure: boolean
  const key = randomBytes(32)

  function createPeer(): SyncPeerService {
    return new SyncPeerService({
      directory: path.join(root, 'peer'),
      fetch: (input, init) => requestFetch(input, init),
      protectToken: (token) => {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
      },
      revealToken: (wrapped) => {
        const data = Buffer.from(wrapped, 'base64')
        const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
        cipher.setAuthTag(data.subarray(12, 28))
        return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
      },
      isLocalDatabaseEncrypted: () => false,
      importSnapshot: async (file) => {
        imported.push(await readFile(file))
        return { success: true, message: 'sync.success.importComplete' }
      }
    })
  }

  async function writeBackup(encrypted = false): Promise<void> {
    fileName = `backup-${Date.now()}.zip`
    bytes = Buffer.from(
      zipSync({
        'manifest.json': strToU8(JSON.stringify({ version: 3, databaseEncrypted: encrypted })),
        'database/agent.db': randomBytes(400_000)
      })
    )
    await writeFile(path.join(root, 'backups', fileName), bytes)
  }

  async function publish(encrypted = false): Promise<void> {
    await writeBackup(encrypted)
    await host.publishSnapshot()
  }

  async function pair(): Promise<void> {
    const code = host.createPairingCode()!
    await peer.pair({
      hostUrl: 'https://sync.example.test',
      hostId: code.hostId,
      code: code.code,
      deviceName: 'Receiving device'
    })
  }

  async function settled(): Promise<void> {
    await vi.waitFor(
      async () => {
        expect(['completed', 'failed', 'cancelled']).toContain((await peer.getStatus()).phase)
      },
      { timeout: 5000 }
    )
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-tunnel-pair-'))
    await mkdir(path.join(root, 'backups'))
    imported = []
    requests = []
    exportFailure = false
    host = new SyncHostService({
      createBackup: async () => {
        if (exportFailure) throw new Error('export failed')
        return { fileName, size: bytes.length, createdAt: Number(fileName.slice(7, -4)) }
      },
      getFolderPath: () => path.join(root, 'backups'),
      getUserDataPath: () => path.join(root, 'host'),
      getAppVersion: () => '1.1.2'
    })
    await host.initialize()
    await host.start()
    const port = (await host.getStatus()).port!
    hostOrigin = `http://127.0.0.1:${port}`
    await host.setEnabled(true, { port, consent: true })
    requestFetch = async (input, init) => {
      const url = new URL(String(input))
      requests.push({ path: url.pathname, range: new Headers(init?.headers).get('range') })
      return fetch(hostOrigin + url.pathname, init)
    }
    peer = createPeer()
  })

  afterEach(async () => {
    await peer.stop()
    await host.stop()
    await rm(root, { recursive: true, force: true })
  })

  it('rejects non-renderer callers on every peer control route', async () => {
    const context = {
      caller: {
        kind: 'cli' as const,
        principal: 'human' as const,
        connectionId: 'probe',
        scopes: []
      }
    }
    for (const handler of createSyncPeerRoutes(peer).values()) {
      await expect(handler({}, context)).rejects.toThrow('renderer caller')
    }
    expect(requests).toEqual([])
  })

  it('prepares data on the first sync without manual publication and rejects anonymous preparation', async () => {
    await writeBackup()
    expect((await host.getStatus()).hasSnapshot).toBe(false)
    expect((await fetch(hostOrigin + '/sync/v1/prepare', { method: 'POST' })).status).toBe(401)
    expect((await host.getStatus()).hasSnapshot).toBe(false)
    await pair()
    await peer.pull('increment')
    await settled()
    expect(imported).toHaveLength(1)
    expect(imported[0].equals(bytes)).toBe(true)
    expect(requests.filter((request) => request.path.endsWith('/prepare'))).toHaveLength(1)
    expect((await peer.getStatus()).lastSuccessAt).toBeTypeOf('number')
  })

  it('requires consent and preserves a published snapshot when export fails', async () => {
    await host.setEnabled(false)
    await expect(host.setEnabled(true, { port: Number(new URL(hostOrigin).port) })).rejects.toThrow(
      'consentRequired'
    )
    expect((await host.getStatus()).running).toBe(false)
    await host.setEnabled(true, { port: Number(new URL(hostOrigin).port), consent: true })
    await publish()
    await pair()
    exportFailure = true
    await expect(host.publishSnapshot()).rejects.toThrow('export failed')
    await peer.pull('increment')
    await settled()
    expect(imported).toEqual([])
    expect((await peer.getStatus()).error).toBe('sync.tunnel.error.prepareFailed')
    expect((await host.getStatus()).hasSnapshot).toBe(true)
    const state = JSON.parse(await readFile(path.join(root, 'peer', 'pairing.json'), 'utf8'))
    expect(state.token).toBeUndefined()
    expect(state.wrappedToken).toBeTypeOf('string')
    expect(JSON.stringify(await peer.getStatus())).not.toContain(state.wrappedToken)
  })

  it('resumes an interrupted download after a client restart and imports only the verified file', async () => {
    await publish()
    await pair()
    const ordinaryFetch = requestFetch
    let interrupted = false
    requestFetch = async (input, init) => {
      const response = await ordinaryFetch(input, init)
      if (!String(input).endsWith('/snapshot') || interrupted) return response
      interrupted = true
      const reader = response.body!.getReader()
      let first = true
      return new Response(
        new ReadableStream(
          {
            async pull(controller) {
              if (!first) {
                await reader.cancel()
                controller.error(new Error('connection lost'))
                return
              }
              first = false
              const read = await reader.read()
              controller.enqueue(read.value!)
            },
            cancel: () => reader.cancel()
          },
          { highWaterMark: 0 }
        ),
        { headers: response.headers, status: response.status }
      )
    }
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).phase).toBe('failed')
    expect(imported).toEqual([])
    const partial = await stat(path.join(root, 'peer', 'snapshot.part'))
    expect(partial.size).toBeGreaterThan(0)
    expect(partial.size).toBeLessThan(bytes.length)
    await peer.stop()
    peer = createPeer()
    await peer.pull('increment')
    await settled()
    expect(requests.some((request) => request.range === `bytes=${partial.size}-`)).toBe(true)
    expect(imported).toEqual([bytes])
    expect((await peer.getStatus()).phase).toBe('completed')
    expect(requests.filter((request) => request.path.endsWith('/prepare'))).toHaveLength(1)
  })

  it('rejects a snapshot switch between status and download, then accepts a fresh retry', async () => {
    await publish()
    await pair()
    const ordinaryFetch = requestFetch
    let replace = true
    requestFetch = async (input, init) => {
      if (String(input).endsWith('/snapshot') && replace) {
        replace = false
        await publish()
      }
      return ordinaryFetch(input, init)
    }
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).error).toBe('sync.tunnel.error.snapshotChanged')
    expect(imported).toEqual([])
    await peer.pull('increment')
    await settled()
    expect(imported).toEqual([bytes])
  })

  it('cancels before import and allows a subsequent pull', async () => {
    await publish()
    await pair()
    const ordinaryFetch = requestFetch
    let cancel = true
    requestFetch = async (input, init) => {
      const response = await ordinaryFetch(input, init)
      if (String(input).endsWith('/snapshot') && cancel) {
        cancel = false
        await peer.cancel()
      }
      return response
    }
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).phase).toBe('cancelled')
    expect(imported).toEqual([])
    await peer.pull('increment')
    await settled()
    expect(imported).toEqual([bytes])
  })

  it('rejects a corrupted body and never calls import', async () => {
    await publish()
    await pair()
    const ordinaryFetch = requestFetch
    requestFetch = async (input, init) => {
      const response = await ordinaryFetch(input, init)
      if (!String(input).endsWith('/snapshot')) return response
      const body = new Uint8Array(await response.arrayBuffer())
      body[body.length - 1] ^= 1
      return new Response(body, { headers: response.headers })
    }
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).error).toBe('sync.tunnel.error.integrityFailed')
    expect(imported).toEqual([])
    await expect(stat(path.join(root, 'peer', 'snapshot.part'))).rejects.toThrow()
  })

  it('rejects encrypted snapshots and revoked devices before downloading', async () => {
    await publish(true)
    await pair()
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).error).toBe('sync.tunnel.error.encryptedSnapshot')
    expect(requests.some((request) => request.path.endsWith('/snapshot'))).toBe(false)
    await host.revokeDevice(host.listDevices()[0].deviceId)
    await peer.pull('increment')
    await settled()
    expect((await peer.getStatus()).error).toBe('sync.tunnel.error.unauthorized')
    expect(imported).toEqual([])
  })

  it('requires overwrite confirmation and the out-of-band host identity', async () => {
    const code = host.createPairingCode()!
    await expect(
      peer.pair({
        hostUrl: 'http://sync.example.test',
        hostId: code.hostId,
        code: code.code,
        deviceName: 'Laptop'
      })
    ).rejects.toThrow('invalidUrl')
    await expect(
      peer.pair({
        hostUrl: 'https://sync.example.test',
        hostId: 'another-host',
        code: code.code,
        deviceName: 'Laptop'
      })
    ).rejects.toThrow('hostChanged')
    expect(host.listDevices()).toHaveLength(0)
    await pair()
    await expect(peer.pull('overwrite')).rejects.toThrow('overwriteConfirmation')
    expect(imported).toEqual([])
  })

  it('reads compressed manifest metadata and rejects oversized manifests', async () => {
    const archive = zipSync({
      'database/agent.db': new Uint8Array(16 * 1024 ** 2),
      'manifest.json': strToU8('{"version":3}')
    })
    const name = 'backup-1.zip'
    await writeFile(path.join(root, 'backups', name), archive)
    const source = new SyncHostSnapshotSource({
      listBackups: async () => [{ fileName: name, size: archive.length, createdAt: 1 }],
      getFolderPath: () => path.join(root, 'backups')
    })
    expect((await source.current())?.backupFormatVersion).toBe(3)
    await writeFile(
      path.join(root, 'backups', name),
      zipSync({ 'manifest.json': new Uint8Array(2 * 1024 ** 2) })
    )
    expect((await source.current())?.backupFormatVersion).toBeNull()
  })
})
