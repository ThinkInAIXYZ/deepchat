import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This suite exercises a real loopback listener against real files on disk, so the global
// partial `fs` mock from test/setup.ts must not apply here.
vi.unmock('fs')
vi.unmock('node:fs')

import { SYNC_HOST_MAX_CONNECTIONS, SYNC_HOST_PATH_PREFIX } from '@shared/contracts/syncHost'
import { SyncHostService } from '@/sync/host'
import { SyncHostSnapshotSource } from '@/sync/host/snapshot'
import { SyncHostPairingAuthority } from '@/sync/host/pairing'

const BACKUP_FILE_NAME = 'backup-1700000000000.zip'
const BACKUP_FORMAT_VERSION = 3
const DB_PAYLOAD_BYTES = 1_500_000
const REQUEST_RECEIVE_TIMEOUT_MS = 400

/**
 * Exercises the real loopback listener: host mode is a security boundary, so these tests assert
 * observable HTTP behavior rather than internal wiring.
 */
describe('SyncHostService endpoint', () => {
  let tempDir: string
  let syncDir: string
  let service: SyncHostService
  let baseUrl: string
  let backupBytes: Buffer
  let publicationDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-sync-host-'))
    syncDir = path.join(tempDir, 'sync')
    await mkdir(syncDir, { recursive: true })

    // Random (and therefore incompressible) so the package keeps its real size; a repetitive
    // payload compresses to a few kilobytes and hides streaming and resume behaviour.
    const payload = randomBytes(DB_PAYLOAD_BYTES)
    const archive = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({ version: BACKUP_FORMAT_VERSION, databaseEncrypted: false })
      ),
      'agent.db': new Uint8Array(payload)
    })
    backupBytes = Buffer.from(archive)
    await writeFile(path.join(syncDir, BACKUP_FILE_NAME), backupBytes)

    publicationDir = path.join(tempDir, 'sync-host', 'snapshots')
    service = new SyncHostService({
      createBackup: async () => ({
        fileName: BACKUP_FILE_NAME,
        createdAt: 1_700_000_000_000,
        size: backupBytes.length
      }),
      getFolderPath: () => syncDir,
      getUserDataPath: () => tempDir,
      getAppVersion: () => '9.9.9',
      requestReceiveTimeoutMs: REQUEST_RECEIVE_TIMEOUT_MS
    })
    await service.initialize()
    await service.start()
    const started = await service.getStatus()
    baseUrl = `http://127.0.0.1:${started.port}`
    await service.setEnabled(true, { port: started.port!, consent: true })
    await service.publishSnapshot()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await service.stop()
    await rm(tempDir, { recursive: true, force: true })
  })

  async function pairDevice(name = 'Laptop'): Promise<{ deviceId: string; token: string }> {
    const pairing = service.createPairingCode()
    expect(pairing).not.toBeNull()
    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing?.code, deviceName: name })
    })
    expect(response.status).toBe(200)
    return (await response.json()) as { deviceId: string; token: string }
  }

  it('requires a host grant before a requesting device can write and supports downgrading it', async () => {
    await service.setEnabled(true, {
      port: Number(new URL(baseUrl).port),
      consent: true,
      bidirectional: true
    })
    const pairing = service.createPairingCode()!
    const replicaId = randomUUID()
    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pairing.code,
        deviceName: 'Writable laptop',
        bidirectional: true,
        replicaId
      })
    })
    expect(response.status).toBe(200)
    const { deviceId } = (await response.json()) as { deviceId: string }
    expect(service.listDevices().find((device) => device.deviceId === deviceId)).toMatchObject({
      writable: false,
      requestedWrite: true
    })
    expect(await service.setDeviceWritable(deviceId, true)).toBe(true)
    expect(service.listDevices().find((device) => device.deviceId === deviceId)?.writable).toBe(
      true
    )
    expect(await service.setDeviceWritable(deviceId, false)).toBe(true)
    expect(service.listDevices().find((device) => device.deviceId === deviceId)?.writable).toBe(
      false
    )
    expect(await service.setDeviceWritable(deviceId, true)).toBe(true)
    await service.setEnabled(true, { port: Number(new URL(baseUrl).port), consent: true })
    expect(service.listDevices().find((device) => device.deviceId === deviceId)?.writable).toBe(
      false
    )
    expect(await service.setDeviceWritable(deviceId, true)).toBe(false)
    await service.setEnabled(true, {
      port: Number(new URL(baseUrl).port),
      consent: true,
      bidirectional: true
    })
    expect(service.listDevices().find((device) => device.deviceId === deviceId)?.writable).toBe(
      false
    )
    const duplicateCode = service.createPairingCode()!
    const duplicate = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: duplicateCode.code,
        deviceName: 'Cloned laptop',
        bidirectional: true,
        replicaId
      })
    })
    expect(duplicate.status).toBe(409)
    expect(service.listDevices()).toHaveLength(1)
  })

  it('rejects a two-way pairing without a replica identity before consuming the code', async () => {
    const pairing = service.createPairingCode()!
    const pair = `${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`
    const invalid = await fetch(pair, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceName: 'Old client', bidirectional: true })
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'automaticUnsupported' })
    expect(service.listDevices()).toHaveLength(0)
    const valid = await fetch(pair, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceName: 'Current client' })
    })
    expect(valid.status).toBe(200)
  })

  it('serves handshake without authentication and advertises only real capabilities', async () => {
    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      protocol: string
      hostId: string
      capabilities: string[]
      encryption: { transport: string }
    }
    expect(body.protocol).toBe('sync/v1')
    expect(body.hostId).toBe(service.getHostId())
    expect(body.capabilities).toEqual(['snapshot', 'range'])
    expect(body.encryption.transport).toBe('tls')
  })

  it('rejects browser origins, foreign hosts and non-JSON pairing requests', async () => {
    const handshake = `${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`
    const foreignHostStatus = await new Promise<number>((resolve, reject) => {
      const request = http.get(handshake, { headers: { host: 'attacker.example' } }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode ?? 0))
      })
      request.once('error', reject)
    })
    expect(foreignHostStatus).toBe(403)
    expect(
      (await fetch(handshake, { headers: { origin: 'https://attacker.example' } })).status
    ).toBe(403)

    const code = service.createPairingCode()!
    const pair = `${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`
    const body = JSON.stringify({ code: code.code, deviceName: 'Laptop' })
    expect(
      (await fetch(pair, { method: 'POST', headers: { 'content-type': 'text/plain' }, body }))
        .status
    ).toBe(415)
    expect(
      (
        await fetch(pair, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        })
      ).status
    ).toBe(200)
  })

  it('does not share an anonymous rate-limit bucket across external tunnel clients', async () => {
    const port = Number(new URL(baseUrl).port)
    await service.setEnabled(false)
    await service.setEnabled(true, {
      port,
      consent: true,
      tunnel: { mode: 'external', publicUrl: 'https://sync.example.test' }
    })
    const agent = new http.Agent({ keepAlive: true })
    try {
      for (const host of ['sync.example.test', `127.0.0.1:${port}`]) {
        for (let attempt = 0; attempt < 121; attempt += 1) {
          const status = await new Promise<number>((resolve, reject) => {
            const request = http.get(
              `${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`,
              { agent, headers: { host } },
              (response) => {
                response.resume()
                response.once('end', () => resolve(response.statusCode ?? 0))
              }
            )
            request.once('error', reject)
          })
          expect(status).toBe(200)
        }
      }
    } finally {
      agent.destroy()
    }
  })

  it('answers every unauthenticated request with one uniform 401 regardless of path or method', async () => {
    const probes: Array<[string, string]> = [
      ['GET', `${SYNC_HOST_PATH_PREFIX}/status`],
      ['GET', `${SYNC_HOST_PATH_PREFIX}/snapshot`],
      ['PUT', `${SYNC_HOST_PATH_PREFIX}/status`],
      ['DELETE', `${SYNC_HOST_PATH_PREFIX}/snapshot`],
      ['GET', `${SYNC_HOST_PATH_PREFIX}/push`],
      ['GET', '/secret'],
      ['POST', `${SYNC_HOST_PATH_PREFIX}/handshake`]
    ]
    for (const [method, url] of probes) {
      const response = await fetch(`${baseUrl}${url}`, { method })
      expect({ method, url, status: response.status }).toEqual({ method, url, status: 401 })
    }

    const forged = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${'a'.repeat(43)}` }
    })
    expect(forged.status).toBe(401)
    const wrongScheme = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { authorization: `Basic ${'a'.repeat(43)}` }
    })
    expect(wrongScheme.status).toBe(401)
  })

  it('distinguishes unknown routes and methods only after authentication', async () => {
    const { token } = await pairDevice()
    const headers = { authorization: `Bearer ${token}` }

    const unknown = await fetch(`${baseUrl}/secret`, { headers })
    expect(unknown.status).toBe(404)
    const wrongMethod = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      method: 'PUT',
      headers
    })
    expect(wrongMethod.status).toBe(405)
    const notImplemented = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/push`, {
      method: 'POST',
      headers
    })
    expect(notImplemented.status).toBe(501)
  })

  it('issues a single-use pairing code and reports snapshot metadata to the paired device', async () => {
    const pairing = service.createPairingCode()
    expect(pairing).not.toBeNull()

    const wrongCode = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'WRONGCODE', deviceName: 'Laptop' })
    })
    expect(wrongCode.status).toBe(401)

    const blankName = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing?.code, deviceName: '   ' })
    })
    expect(blankName.status).toBe(400)

    const paired = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing?.code, deviceName: 'Laptop' })
    })
    expect(paired.status).toBe(200)
    const issued = (await paired.json()) as { deviceId: string; token: string }
    expect(issued.token).toHaveLength(43)

    const reused = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing?.code, deviceName: 'Second' })
    })
    expect(reused.status).toBe(401)

    const status = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${issued.token}` }
    })
    expect(status.status).toBe(200)
    const body = (await status.json()) as {
      snapshot: {
        fileName: string
        size: number
        sha256: string
        backupFormatVersion: number
        databaseEncrypted: boolean
      }
    }
    expect(body.snapshot.fileName).toBe(BACKUP_FILE_NAME)
    expect(body.snapshot.size).toBe(backupBytes.length)
    expect(body.snapshot.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(body.snapshot.databaseEncrypted).toBe(false)
    expect(body.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a revoked device token immediately', async () => {
    const issued = await pairDevice()
    const before = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${issued.token}` }
    })
    expect(before.status).toBe(200)

    expect(await service.revokeDevice(issued.deviceId)).toBe(true)

    const after = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${issued.token}` }
    })
    expect(after.status).toBe(401)
    expect(service.listDevices()).toEqual([
      expect.objectContaining({ deviceId: issued.deviceId, revoked: true })
    ])
  })

  it('keeps device token hashes out of the settings store and out of plaintext state', async () => {
    const issued = await pairDevice()
    const stateFile = path.join(tempDir, 'sync-host', 'host-state.json')
    const state = await readFile(stateFile, 'utf8')
    const mode = (await stat(stateFile)).mode & 0o777

    expect(state).not.toContain(issued.token)
    expect(JSON.parse(state).devices[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(mode).toBe(0o600)
  })

  it('streams the snapshot whole and resumes it with byte-exact ranges', async () => {
    const { token } = await pairDevice()
    const headers = { authorization: `Bearer ${token}` }

    const full = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, { headers })
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    const fullBytes = Buffer.from(await full.arrayBuffer())
    expect(fullBytes.equals(backupBytes)).toBe(true)

    const ranged = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { ...headers, range: 'bytes=100-199' }
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe(`bytes 100-199/${backupBytes.length}`)
    const rangedBytes = Buffer.from(await ranged.arrayBuffer())
    expect(rangedBytes.equals(backupBytes.subarray(100, 200))).toBe(true)

    const resumed = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { ...headers, range: `bytes=${backupBytes.length - 10}-` }
    })
    expect(resumed.status).toBe(206)
    const resumedBytes = Buffer.from(await resumed.arrayBuffer())
    expect(resumedBytes.equals(backupBytes.subarray(backupBytes.length - 10))).toBe(true)

    const unsatisfiable = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { ...headers, range: `bytes=${backupBytes.length + 5}-` }
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${backupBytes.length}`)
  })

  it('resumes a download that was aborted mid-stream', async () => {
    const { token } = await pairDevice()
    const headers = { authorization: `Bearer ${token}` }

    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, { headers })
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    const first = await reader!.read()
    expect(first.done).toBe(false)
    const partial = Buffer.from(first.value)
    const received = partial.length
    await reader!.cancel()
    expect(received).toBeLessThan(backupBytes.length)

    const resumed = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { ...headers, range: `bytes=${received}-` }
    })
    expect(resumed.status).toBe(206)
    const rest = Buffer.from(await resumed.arrayBuffer())
    expect(Buffer.concat([partial, rest]).equals(backupBytes)).toBe(true)
  })

  it('is reachable only on loopback', async () => {
    const { port } = await service.getStatus()

    const loopback = await fetch(`http://127.0.0.1:${port}${SYNC_HOST_PATH_PREFIX}/handshake`)
    expect(loopback.status).toBe(200)

    // 127.0.0.2 is loopback but a different address, so it proves the bind is address-specific
    // rather than a wildcard bind. Unlike an external-interface probe it exists on every host, so
    // the assertion can never silently skip.
    await expect(
      fetch(`http://127.0.0.2:${port}${SYNC_HOST_PATH_PREFIX}/handshake`, {
        signal: AbortSignal.timeout(2_000)
      })
    ).rejects.toThrow()

    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    if (external) {
      await expect(
        fetch(`http://${external.address}:${port}${SYNC_HOST_PATH_PREFIX}/handshake`, {
          signal: AbortSignal.timeout(1_000)
        })
      ).rejects.toThrow()
    }
  })

  it('lets a new caller in when the connection ceiling is full of stalled sockets', async () => {
    const { port } = await service.getStatus()
    const stalled: ReturnType<typeof connect>[] = []
    for (let index = 0; index < SYNC_HOST_MAX_CONNECTIONS; index += 1) {
      const socket = connect({ host: '127.0.0.1', port })
      stalled.push(socket)
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
      // Announce a body that never arrives: these occupy slots without ever completing a request.
      socket.write(
        `POST ${SYNC_HOST_PATH_PREFIX}/pair HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
          `Content-Type: application/json\r\nContent-Length: 100000\r\n\r\n`
      )
    }
    try {
      // The newcomer must be admitted by evicting a stalled connection, not refused: otherwise
      // anyone who learns the hostname can deny the user's own pairing with idle sockets.
      const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`, {
        signal: AbortSignal.timeout(3_000)
      })
      expect(response.status).toBe(200)
    } finally {
      for (const socket of stalled) socket.destroy()
    }
  })

  it('lets a newcomer in after the ceiling is filled with finished keep-alive downloads', async () => {
    const { token } = await pairDevice()
    // Range 0-0 keeps each download one byte while still exercising the streaming path.
    const agent = new http.Agent({ keepAlive: true, maxSockets: SYNC_HOST_MAX_CONNECTIONS })
    try {
      await Promise.all(
        Array.from({ length: SYNC_HOST_MAX_CONNECTIONS }, async () => {
          const { port } = await service.getStatus()
          await new Promise<void>((resolve, reject) => {
            const request = http.get(
              {
                host: '127.0.0.1',
                port,
                path: `${SYNC_HOST_PATH_PREFIX}/snapshot`,
                agent,
                headers: { authorization: `Bearer ${token}`, range: 'bytes=0-0' }
              },
              (response) => {
                response.resume()
                response.on('end', () => resolve())
                response.on('error', reject)
              }
            )
            request.on('error', reject)
          })
        })
      )

      // The download sockets are still open (keep-alive). If a finished download left its socket
      // marked as streaming, every slot would be unevictable and this request would be refused.
      const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`, {
        signal: AbortSignal.timeout(3_000)
      })
      expect(response.status).toBe(200)
    } finally {
      agent.destroy()
    }
  })

  it('charges an authenticated device for unknown paths instead of letting it flush the audit ring', async () => {
    const { token } = await pairDevice()
    const headers = { authorization: `Bearer ${token}` }

    let throttled = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await fetch(`${baseUrl}/unknown-${attempt}`, { headers })
      if (response.status === 429) {
        throttled = true
        break
      }
      expect(response.status).toBe(404)
    }

    // A paired device must not be able to append unbounded 404 entries by probing unknown paths.
    expect(throttled).toBe(true)
  })

  it('coalesces anonymous rejections instead of letting them flush the audit ring', async () => {
    const before = service.getAuditEntries().length
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`)
      expect(response.status).toBe(401)
    }

    const entries = service.getAuditEntries()
    const unauthorized = entries.filter((entry) => entry.status === 401)
    // Every repeat is counted, not appended: an anonymous caller must not be able to evict the rest
    // of the ring by hammering the endpoint.
    expect(unauthorized).toHaveLength(1)
    expect(unauthorized[0].suppressed).toBe(24)
    expect(entries.length - before).toBe(1)
  })

  it('keeps the published snapshot when a newer ordinary backup appears', async () => {
    const impostor = 'backup-1800000000000.zip'
    const archive = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 3 })) })
    await writeFile(path.join(syncDir, impostor), Buffer.from(archive))

    const { token } = await pairDevice()
    const status = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(status.status).toBe(200)
    const body = (await status.json()) as { snapshot: { fileName: string } | null }
    expect(body.snapshot?.fileName).toBe(BACKUP_FILE_NAME)
  })

  it('returns one host identity before initialize() and persists it', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'deepchat-sync-host-id-'))
    try {
      const uninitialized = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      // Two callers before the first load must not observe two different host identities: this is
      // the value a slave compares against the pairing payload.
      const first = uninitialized.getHostId()
      const second = uninitialized.getHostId()
      expect(second).toBe(first)

      await uninitialized.initialize()
      expect(uninitialized.getHostId()).toBe(first)
      // Flush the queued write before asserting durability from a second instance.
      await uninitialized.stop()

      const reloaded = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await reloaded.initialize()
      expect(reloaded.getHostId()).toBe(first)
    } finally {
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('reaps a stalled request instead of holding a connection slot', async () => {
    const { port } = await service.getStatus()
    const socket = connect({ host: '127.0.0.1', port })
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stalled socket was never reaped')), 5_000)
      socket.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.on('error', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    // Announce a body that never arrives.
    socket.write(
      `POST ${SYNC_HOST_PATH_PREFIX}/pair HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        `Content-Type: application/json\r\nContent-Length: 100000\r\n\r\n`
    )

    await closed

    const healthy = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`)
    expect(healthy.status).toBe(200)
  })

  it('settles and audits a snapshot request aborted while the snapshot is being resolved', async () => {
    const { token } = await pairDevice()

    // Hold the snapshot resolution open (the real digest pass takes seconds on a large package) and
    // drop the connection inside that window. The handler must still settle, audit the request and
    // release the read stream; a hook attached only after the await would hang forever and leave no
    // audit entry at all.
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = SyncHostSnapshotSource.prototype.current
    vi.spyOn(SyncHostSnapshotSource.prototype, 'current').mockImplementation(async function () {
      await gate
      return original.call(this)
    })

    const controller = new AbortController()
    const pending = fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    }).catch(() => undefined)

    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    await pending
    release()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const audit = service.getAuditEntries().filter((entry) => entry.path.endsWith('/snapshot'))
    expect(audit.map((entry) => entry.status)).toEqual([499])
  })

  it('reports no snapshot instead of failing when the publication disappears', async () => {
    const { token } = await pairDevice()
    await rm(publicationDir, { recursive: true })

    // A storage failure is a transient condition a slave retries: it must see "no snapshot", never
    // a 500 that looks like a broken host.
    const status = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(status.status).toBe(200)
    expect(((await status.json()) as { snapshot: unknown }).snapshot).toBeNull()

    const snapshot = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/snapshot`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(snapshot.status).toBe(404)
  })

  it('stops listening and removes its descriptor when host mode is disabled', async () => {
    const descriptorPath = path.join(tempDir, 'sync-host', 'endpoint.json')
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { port: number }
    expect(descriptor.port).toBe((await service.getStatus()).port)

    await service.setEnabled(false)

    expect((await service.getStatus()).port).toBeNull()
    expect(service.getEnabled()).toBe(false)
    await expect(stat(descriptorPath)).rejects.toThrow()
    await expect(fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`)).rejects.toThrow()
  })

  it('keeps the listener and the enabled flag consistent under interleaved enable/disable', async () => {
    await Promise.all([
      service.setEnabled(false),
      service.setEnabled(true, { port: Number(new URL(baseUrl).port), consent: true }),
      service.setEnabled(true, { port: Number(new URL(baseUrl).port), consent: true }),
      service.setEnabled(false),
      service.setEnabled(true, { port: Number(new URL(baseUrl).port), consent: true })
    ])

    const enabled = await service.getStatus()
    expect(enabled.enabled).toBe(true)
    expect(enabled.running).toBe(true)
    expect(enabled.port).not.toBeNull()

    await Promise.all([service.setEnabled(false), service.setEnabled(false)])
    const disabled = await service.getStatus()
    expect(disabled.enabled).toBe(false)
    expect(disabled.running).toBe(false)
    expect(disabled.port).toBeNull()
  })

  it('stops the listener on teardown without disabling host mode', async () => {
    await service.setEnabled(true, { port: Number(new URL(baseUrl).port), consent: true })

    await service.stop()

    const status = await service.getStatus()
    expect(status.running).toBe(false)
    expect(status.port).toBeNull()
    // Host mode must survive a restart: teardown is not a disable.
    expect(status.enabled).toBe(true)
  })

  it('expires pairing codes without accepting them', () => {
    const authority = new SyncHostPairingAuthority(() => 'host-1')
    const created = authority.create({ now: 1_000, ttlMs: 5_000 })
    expect(authority.consume(created.code, 5_999)).toBe('accepted')

    const expiring = authority.create({ now: 1_000, ttlMs: 5_000 })
    expect(authority.consume(expiring.code, 6_000)).toBe('expired')
  })

  it('does not persist the host identity until initialize() writes it', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'deepchat-sync-host-lazy-'))
    try {
      const uninitialized = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      const identity = uninitialized.getHostId()
      // Reading the identity must not write: a fire-and-forget write here can fail and roll the
      // cache back after initialize() already adopted the value, leaving two identities in play.
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(stat(path.join(userData, 'sync-host', 'host-state.json'))).rejects.toThrow()

      await uninitialized.initialize()
      const persisted = JSON.parse(
        await readFile(path.join(userData, 'sync-host', 'host-state.json'), 'utf8')
      ) as { hostId: string }
      expect(persisted.hostId).toBe(identity)
      await uninitialized.stop()
    } finally {
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('restores a consumed pairing code when pairing could not be completed', () => {
    const authority = new SyncHostPairingAuthority(() => 'host-1')
    const created = authority.create({ now: 1_000, ttlMs: 600_000 })
    expect(authority.consume(created.code, 1_001)).toBe('accepted')
    expect(authority.current(1_002)).toBeNull()

    authority.restore(created.code, created.expiresAt, 1_003)
    expect(authority.consume(created.code, 1_004)).toBe('accepted')

    // Never clobbers a code the user generated in the meantime, and never revives an expired one.
    const fresh = authority.create({ now: 2_000, ttlMs: 600_000 })
    authority.restore(created.code, created.expiresAt, 2_001)
    expect(authority.current(2_002)?.code).toBe(fresh.code)

    authority.clear()
    authority.restore(created.code, 5_000, 6_000)
    expect(authority.current(6_001)).toBeNull()
  })

  it('does not let failed attempts destroy or block the user pairing code', () => {
    const authority = new SyncHostPairingAuthority(() => 'host-1')
    const created = authority.create({ now: 1_000, ttlMs: 600_000 })

    // Far more failures than any per-code budget: the code must still be intact and usable.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(authority.consume('WRONGCODE', 1_000 + attempt)).toBe('invalid')
    }
    expect(authority.consume(created.code, 2_000)).toBe('accepted')
  })

  it('charges pairing failures to the calling source, not to everyone', async () => {
    const code = service.createPairingCode()
    expect(code).not.toBeNull()

    let throttled = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'WRONGCODE', deviceName: 'Attacker' })
      })
      if (response.status === 429) {
        throttled = true
        break
      }
      expect(response.status).toBe(401)
    }
    expect(throttled).toBe(true)

    // A fresh code minted for the user must still pair: the attacker only spent their own budget.
    const fresh = service.createPairingCode()
    expect(fresh).not.toBeNull()
  })

  it('rejects an oversized pairing body with 413 instead of resetting the connection', async () => {
    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'x'.repeat(8_192), deviceName: 'Big' })
    })
    expect(response.status).toBe(413)
  })

  it('survives a corrupt archive without hanging or throwing', async () => {
    await writeFile(path.join(publicationDir, BACKUP_FILE_NAME), Buffer.from('not a zip at all'))

    const { token } = await pairDevice()
    const response = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/status`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      snapshot: { backupFormatVersion: number | null; sha256: string }
    }
    expect(body.snapshot.backupFormatVersion).toBeNull()
    expect(body.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('preserves existing state when a mutation arrives before initialize()', async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'deepchat-sync-host-uninit-'))
    try {
      const seed = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await seed.initialize()
      const issued = await seed.listDevices()
      expect(issued).toEqual([])
      await seed.start()
      const firstToken = await seed.setEnabled(true, {
        port: (await seed.getStatus()).port!,
        consent: true
      })
      expect(firstToken.enabled).toBe(true)
      // Release the listener seed.setEnabled(true) started before the files are removed.
      await seed.stop()

      // A second instance that mutates before any explicit initialize() must not wipe the file.
      // The mutation has to be a real one: with the read-modify-write bug this persisted the empty
      // default state over the file, discarding the enabled flag and every device record.
      const late = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      expect(await late.renameDevice('dev_missing', 'Renamed')).toBe(false)
      await late.stop()

      const reloaded = new SyncHostService({
        createBackup: async () => null,
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await reloaded.initialize()
      expect(reloaded.getEnabled()).toBe(true)
      expect(reloaded.listDevices()).toEqual([])
    } finally {
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('keeps a revoked device revoked across a state reload', async () => {
    const issued = await pairDevice()
    expect(await service.revokeDevice(issued.deviceId)).toBe(true)

    const reloaded = new SyncHostService({
      createBackup: async () => null,
      getFolderPath: () => syncDir,
      getUserDataPath: () => tempDir,
      getAppVersion: () => '9.9.9'
    })
    await reloaded.initialize()

    expect(reloaded.listDevices()).toEqual([
      expect.objectContaining({ deviceId: issued.deviceId, revoked: true })
    ])
  })
})
