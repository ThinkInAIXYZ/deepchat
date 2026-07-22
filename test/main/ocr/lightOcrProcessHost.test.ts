import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePrivateInputPath } from '../../../src/main/ocr/lightOcrHelper'
import {
  createLightOcrHelperEnvironment,
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

  it('inherits only required process environment variables for the helper', () => {
    const environment = createLightOcrHelperEnvironment(
      {
        PATH: '/usr/bin',
        TMPDIR: '/private/tmp',
        GITHUB_TOKEN: 'secret',
        HTTPS_PROXY: 'https://credentials@example.com',
        NODE_OPTIONS: '--require malicious.js',
        DYLD_INSERT_LIBRARIES: '/tmp/injected.dylib',
        LIGHT_OCR_NODE_BINARY: '/tmp/injected.node',
        LIGHT_OCR_RUNTIME_DESCRIPTOR: '/tmp/injected.json'
      },
      {
        FAKE_OCR_BEHAVIOR: 'cancellable',
        LD_PRELOAD: '/tmp/injected.so'
      }
    )

    expect(environment).toEqual({
      PATH: '/usr/bin',
      TMPDIR: '/private/tmp',
      FAKE_OCR_BEHAVIOR: 'cancellable',
      DEEPCHAT_LIGHT_OCR_HELPER: '1'
    })
  })

  it('adds only the materialized native override selected by the process host', () => {
    const environment = createLightOcrHelperEnvironment(
      { LIGHT_OCR_NODE_BINARY: '/tmp/injected.node' },
      {},
      {
        nodeBinaryPath: '/private/runtime/native/light_ocr_node.node',
        runtimeDescriptorPath: '/private/runtime/native/runtime-descriptor.json'
      }
    )

    expect(environment).toMatchObject({
      LIGHT_OCR_NODE_BINARY: '/private/runtime/native/light_ocr_node.node',
      LIGHT_OCR_RUNTIME_DESCRIPTOR: '/private/runtime/native/runtime-descriptor.json',
      DEEPCHAT_LIGHT_OCR_HELPER: '1'
    })
  })

  it('materializes encoded native bytes once and passes trusted override paths to the helper', async () => {
    const nativePackageDir = path.join(tempDir, 'native-package')
    const nativeDir = path.join(nativePackageDir, 'native')
    await mkdir(nativeDir, { recursive: true })
    const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
    const addon = Buffer.from('qualified-addon')
    const runtime = Buffer.from('qualified-runtime')
    const addonArtifact = {
      path: 'native/light_ocr_node.node',
      bytes: addon.byteLength,
      sha256: hash(addon)
    }
    const runtimeArtifact = {
      path: 'native/libonnxruntime.1.22.0.dylib',
      bytes: runtime.byteLength,
      sha256: hash(runtime)
    }
    const descriptor = Buffer.from(
      JSON.stringify({ addon: addonArtifact, runtime: { artifacts: [runtimeArtifact] } })
    )
    const descriptorArtifact = {
      path: 'native/runtime-descriptor.json',
      bytes: descriptor.byteLength,
      sha256: hash(descriptor)
    }
    await Promise.all([
      writeFile(
        `${path.join(nativePackageDir, addonArtifact.path)}.gz.b64`,
        gzipSync(addon).toString('base64')
      ),
      writeFile(
        `${path.join(nativePackageDir, runtimeArtifact.path)}.gz.b64`,
        gzipSync(runtime).toString('base64')
      ),
      writeFile(path.join(nativePackageDir, descriptorArtifact.path), descriptor),
      writeFile(
        path.join(nativePackageDir, 'artifact-hashes.json'),
        JSON.stringify({ files: [addonArtifact, runtimeArtifact, descriptorArtifact] })
      )
    ])

    const spawnedEnvironments: NodeJS.ProcessEnv[] = []
    const host = createHost({
      nativePackageDir,
      nativePayloadEncoding: 'gzip-base64-v1',
      idleTimeoutMs: 25,
      spawnProcess: ((command, args, options) => {
        spawnedEnvironments.push(options.env)
        return spawn(command, args, options)
      }) as typeof spawn
    })

    await host.prepare({ backend: 'auto', strategy: 'bounded-960' })
    await expect.poll(() => host.getStatus().state, { timeout: 1_000 }).toBe('idle')
    await host.prepare({ backend: 'cpu', strategy: 'tiled-v1' })
    expect(spawnedEnvironments).toHaveLength(2)
    const materializedAddon = spawnedEnvironments[0].LIGHT_OCR_NODE_BINARY
    const materializedDescriptor = spawnedEnvironments[0].LIGHT_OCR_RUNTIME_DESCRIPTOR
    expect(materializedAddon).toBeTypeOf('string')
    expect(materializedDescriptor).toBeTypeOf('string')
    expect(spawnedEnvironments[1].LIGHT_OCR_NODE_BINARY).toBe(materializedAddon)
    expect(spawnedEnvironments[1].LIGHT_OCR_RUNTIME_DESCRIPTOR).toBe(materializedDescriptor)
    await expect(readFile(materializedAddon!)).resolves.toEqual(addon)
    await expect(readFile(materializedDescriptor!)).resolves.toEqual(descriptor)

    await host.close()
    await expect(readFile(materializedAddon!)).rejects.toThrow()
  })

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

  it('prepares the engine and exposes its exact execution identity before recognition', async () => {
    const host = createHost()

    const prepared = await host.prepare({ backend: 'cpu', strategy: 'tiled-v1' })
    const result = await host.recognize({
      encoded: Buffer.from('prepared input'),
      backend: 'cpu',
      strategy: 'tiled-v1'
    })

    expect(prepared).toMatchObject({
      modelBundleId: bundleId,
      requestedProvider: 'cpu',
      strategy: 'tiled-v1',
      detection: { actualProviderChain: ['cpu'], precision: 'fp32' },
      recognition: { actualProviderChain: ['cpu'], precision: 'fp32' }
    })
    expect(result.engine).toEqual(prepared)
  })

  it('restarts once after an abnormal helper exit', async () => {
    const marker = path.join(tempDir, 'crash-marker')
    const host = createHost({
      testEnvironment: {
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
      testEnvironment: {
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
      testEnvironment: {
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
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'hang' },
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
    const host = createHost({ testEnvironment: { FAKE_OCR_BEHAVIOR: 'cancellable' } })
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
      testEnvironment: { FAKE_OCR_SHUTDOWN_DELAY_MS: '75' }
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
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'hang' },
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
