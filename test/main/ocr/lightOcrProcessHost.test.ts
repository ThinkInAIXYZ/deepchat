import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePrivateInputPath } from '../../../src/main/ocr/lightOcrHelper'
import {
  LightOcrProcessHost,
  LightOcrProcessHostError,
  resolveBundledNodeExecutable,
  type LightOcrProcessHostOptions
} from '../../../src/main/ocr/lightOcrProcessHost'

const fixturePath = fileURLToPath(
  new URL('../../fixtures/light-ocr/fake-helper.mjs', import.meta.url)
)
const bundleId = 'ppocrv6-small-native-20260719.1'

describe('LightOcrProcessHost', () => {
  let tempDir: string
  let bundlePath: string
  const hosts: LightOcrProcessHost[] = []

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-light-ocr-host-test-'))
    bundlePath = path.join(tempDir, 'bundle')
    await mkdir(bundlePath)
  })

  afterEach(async () => {
    await Promise.all(hosts.map((host) => host.close()))
    await rm(tempDir, { recursive: true, force: true })
  })

  function createHost(overrides: Partial<LightOcrProcessHostOptions> = {}) {
    const host = new LightOcrProcessHost({
      nodeExecutable: process.execPath,
      helperEntryPath: fixturePath,
      bundlePath,
      expectedBundleId: bundleId,
      expectedNodeVersion: 'v24.14.1',
      tempBaseDir: tempDir,
      initializationTimeoutMs: 2_000,
      recognitionTimeoutMs: 2_000,
      idleTimeoutMs: 10_000,
      cancelGraceMs: 100,
      shutdownGraceMs: 100,
      ...overrides
    })
    hosts.push(host)
    return host
  }

  it('uses an immutable input snapshot and reports the actual engine selection', async () => {
    const host = createHost()
    const input = Buffer.from('snapshot text')
    const resultPromise = host.recognize({
      encoded: input,
      backend: 'auto',
      strategy: 'bounded-960'
    })
    input.fill(0)

    const result = await resultPromise

    expect(result.lines[0].text).toBe('snapshot text')
    expect(result.engine).toMatchObject({
      modelBundleId: bundleId,
      requestedProvider: 'auto',
      strategy: 'bounded-960'
    })
    await expect.poll(() => host.getStatus().state).toBe('ready')
    expect(host.getStatus().nodeVersion).toBe('v24.14.1')
  })

  it('restarts once after an abnormal helper exit', async () => {
    const marker = path.join(tempDir, 'crash-marker')
    const host = createHost({
      helperEnvironment: {
        FAKE_OCR_BEHAVIOR: 'crash-once',
        FAKE_OCR_CRASH_MARKER: marker
      }
    })

    const result = await host.recognize({
      encoded: Buffer.from('after restart'),
      backend: 'cpu',
      strategy: 'tiled-v1'
    })

    expect(result.lines[0].text).toBe('after restart')
    await expect(readFile(marker, 'utf8')).resolves.toBe('1')
  })

  it('rejects a mismatched bundled Node handshake without retrying as a crash', async () => {
    const counter = path.join(tempDir, 'start-counter')
    const host = createHost({
      helperEnvironment: {
        FAKE_OCR_NODE_VERSION: 'v24.15.0',
        FAKE_OCR_START_COUNTER: counter
      }
    })

    await expect(
      host.recognize({
        encoded: Buffer.from('text'),
        backend: 'auto',
        strategy: 'bounded-960'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('treats malformed helper output as a protocol failure without retrying', async () => {
    const counter = path.join(tempDir, 'start-counter')
    const host = createHost({
      helperEnvironment: {
        FAKE_OCR_BEHAVIOR: 'invalid-protocol',
        FAKE_OCR_START_COUNTER: counter
      }
    })

    await expect(
      host.recognize({
        encoded: Buffer.from('text'),
        backend: 'auto',
        strategy: 'bounded-960'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('kills a timed-out helper without retrying the request', async () => {
    const host = createHost({
      helperEnvironment: { FAKE_OCR_BEHAVIOR: 'hang' },
      recognitionTimeoutMs: 50
    })

    await expect(
      host.recognize({
        encoded: Buffer.from('text'),
        backend: 'auto',
        strategy: 'bounded-960'
      })
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(host.getStatus().pid).toBeNull()
  })

  it('cancels active recognition and leaves queued cancellation bounded', async () => {
    const host = createHost({ helperEnvironment: { FAKE_OCR_BEHAVIOR: 'cancellable' } })
    const activeController = new AbortController()
    const queuedController = new AbortController()
    const active = host.recognize({
      encoded: Buffer.from('active'),
      backend: 'cpu',
      strategy: 'bounded-960',
      signal: activeController.signal
    })
    const queued = host.recognize({
      encoded: Buffer.from('queued'),
      backend: 'cpu',
      strategy: 'bounded-960',
      signal: queuedController.signal
    })

    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' })
    activeController.abort()
    await expect(active).rejects.toMatchObject({ code: 'cancelled' })
    expect(host.getStatus().pendingInputBytes).toBe(0)
  })

  it('releases the helper after the configured idle interval', async () => {
    const host = createHost({ idleTimeoutMs: 25 })
    await host.recognize({
      encoded: Buffer.from('text'),
      backend: 'auto',
      strategy: 'bounded-960'
    })

    await expect.poll(() => host.getStatus().state, { timeout: 1_000 }).toBe('idle')
    expect(host.getStatus().pid).toBeNull()
  })

  it('waits for an in-flight idle shutdown before spawning the next helper', async () => {
    const host = createHost({
      idleTimeoutMs: 10,
      helperEnvironment: { FAKE_OCR_SHUTDOWN_DELAY_MS: '75' }
    })
    await host.recognize({
      encoded: Buffer.from('first'),
      backend: 'auto',
      strategy: 'bounded-960'
    })
    await expect.poll(() => host.getStatus().state).toBe('stopping')

    const second = await host.recognize({
      encoded: Buffer.from('second'),
      backend: 'auto',
      strategy: 'bounded-960'
    })

    expect(second.lines[0].text).toBe('second')
  })

  it('enforces queue byte and item limits before copying more input', async () => {
    const host = createHost({
      helperEnvironment: { FAKE_OCR_BEHAVIOR: 'hang' },
      maxPendingRequests: 1,
      maxPendingInputBytes: 4,
      recognitionTimeoutMs: 50
    })
    const first = host.recognize({
      encoded: Buffer.from('1234'),
      backend: 'cpu',
      strategy: 'bounded-960'
    })

    await expect(
      host.recognize({
        encoded: Buffer.from('1'),
        backend: 'cpu',
        strategy: 'bounded-960'
      })
    ).rejects.toMatchObject({ code: 'queue_full' })
    await expect(first).rejects.toMatchObject({ code: 'timeout' })
  })

  it('does not fall back from the explicit bundled Node executable layout', () => {
    expect(resolveBundledNodeExecutable('/runtime/node', 'darwin')).toBe('/runtime/node/bin/node')
    expect(resolveBundledNodeExecutable('C:\\runtime\\node', 'win32')).toBe(
      path.join('C:\\runtime\\node', 'node.exe')
    )
    expect(new LightOcrProcessHostError('runtime_missing', 'missing')).toBeInstanceOf(Error)
  })
})

describe('Light OCR helper input boundary', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-light-ocr-path-test-'))
    await chmod(tempDir, 0o700)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('accepts regular files inside the private root and rejects traversal through symlinks', async () => {
    const privateRoot = path.join(tempDir, 'private')
    const inside = path.join(privateRoot, 'inside.png')
    const outside = path.join(tempDir, 'outside.png')
    const symlinkPath = path.join(privateRoot, 'escape.png')
    await mkdir(privateRoot, { mode: 0o700 })
    await writeFile(inside, 'inside', { mode: 0o600 })
    await writeFile(outside, 'outside', { mode: 0o600 })
    await symlink(outside, symlinkPath)

    await expect(resolvePrivateInputPath(privateRoot, inside)).resolves.toBe(await realpath(inside))
    await expect(resolvePrivateInputPath(privateRoot, outside)).rejects.toMatchObject({
      code: 'invalid_input_path'
    })
    await expect(resolvePrivateInputPath(privateRoot, symlinkPath)).rejects.toMatchObject({
      code: 'invalid_input_path'
    })
  })
})
