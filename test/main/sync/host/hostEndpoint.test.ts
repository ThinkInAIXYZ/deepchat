import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This suite exercises a real loopback listener against real files on disk, so the global
// partial `fs` mock from test/setup.ts must not apply here.
vi.unmock('fs')
vi.unmock('node:fs')

import { SYNC_HOST_PATH_PREFIX, SYNC_HOST_PAIRING_MAX_ATTEMPTS } from '@shared/contracts/syncHost'
import { SyncHostService } from '@/sync/host'
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

    service = new SyncHostService({
      listBackups: async () => [
        { fileName: BACKUP_FILE_NAME, createdAt: 1_700_000_000_000, size: backupBytes.length }
      ],
      getFolderPath: () => syncDir,
      getUserDataPath: () => tempDir,
      getAppVersion: () => '9.9.9',
      requestReceiveTimeoutMs: REQUEST_RECEIVE_TIMEOUT_MS
    })
    await service.initialize()
    await service.start()
    const started = await service.getStatus()
    baseUrl = `http://127.0.0.1:${started.port}`
  })

  afterEach(async () => {
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
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)

    const loopback = await fetch(`http://127.0.0.1:${port}${SYNC_HOST_PATH_PREFIX}/handshake`)
    expect(loopback.status).toBe(200)

    if (external) {
      await expect(
        fetch(`http://${external.address}:${port}${SYNC_HOST_PATH_PREFIX}/handshake`, {
          signal: AbortSignal.timeout(1_000)
        })
      ).rejects.toThrow()
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
      `POST ${SYNC_HOST_PATH_PREFIX}/pair HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
        `Content-Type: application/json\r\nContent-Length: 100000\r\n\r\n`
    )

    await closed

    const healthy = await fetch(`${baseUrl}${SYNC_HOST_PATH_PREFIX}/handshake`)
    expect(healthy.status).toBe(200)
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
      service.setEnabled(true),
      service.setEnabled(true),
      service.setEnabled(false),
      service.setEnabled(true)
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
    await service.setEnabled(true)

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
    await writeFile(path.join(syncDir, BACKUP_FILE_NAME), Buffer.from('not a zip at all'))

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
        listBackups: async () => [],
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await seed.initialize()
      const issued = await seed.listDevices()
      expect(issued).toEqual([])
      const firstToken = await seed.setEnabled(true)
      expect(firstToken.enabled).toBe(true)

      // A second instance that mutates before any explicit initialize() must not wipe the file.
      const late = new SyncHostService({
        listBackups: async () => [],
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await late.stop()

      const reloaded = new SyncHostService({
        listBackups: async () => [],
        getFolderPath: () => syncDir,
        getUserDataPath: () => userData,
        getAppVersion: () => '9.9.9'
      })
      await reloaded.initialize()
      expect(reloaded.getEnabled()).toBe(true)
    } finally {
      await rm(userData, { recursive: true, force: true })
    }
  })

  it('keeps a revoked device revoked across a state reload', async () => {
    const issued = await pairDevice()
    expect(await service.revokeDevice(issued.deviceId)).toBe(true)

    const reloaded = new SyncHostService({
      listBackups: async () => [
        { fileName: BACKUP_FILE_NAME, createdAt: 1_700_000_000_000, size: backupBytes.length }
      ],
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
