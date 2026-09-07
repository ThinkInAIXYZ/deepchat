import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
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
  type LightOcrProcessHostOptions,
  type LightOcrRecognizeDocumentInput
} from '../../../src/main/ocr/lightOcrProcessHost'
import {
  LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS,
  LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  type LightOcrDocumentOptions
} from '../../../src/main/ocr/lightOcrProtocol'

const fixturePath = fileURLToPath(
  new URL('../../fixtures/light-ocr/fake-helper.mjs', import.meta.url)
)
const bundleId = 'ppocrv6-small-native-20260719.1'
const documentOptions: LightOcrDocumentOptions = {
  dpi: 150,
  pageRange: { start: 1, end: 100 },
  maxPages: 100,
  maxFileBytes: LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  maxPagePixels: LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  maxTotalPixels: LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS
}

describe('LightOcrProcessHost', () => {
  let tempDir: string
  let bundlePath: string
  let documentSourceSequence: number
  const hosts: LightOcrProcessHost[] = []

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-light-ocr-host-test-'))
    bundlePath = path.join(tempDir, 'bundle')
    documentSourceSequence = 0
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
      expectedNodeVersion: 'v24.18.0',
      tempBaseDir: tempDir,
      initializationTimeoutMs: 2_000,
      recognitionTimeoutMs: 2_000,
      documentIdleTimeoutMs: 2_000,
      documentTotalTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
      cancelGraceMs: 100,
      shutdownGraceMs: 100,
      ...overrides
    })
    hosts.push(host)
    return host
  }

  async function recognizeTestDocument(
    host: LightOcrProcessHost,
    input: Omit<LightOcrRecognizeDocumentInput, 'snapshot'> & { encoded: Uint8Array }
  ) {
    const sourcePath = path.join(tempDir, `document-source-${documentSourceSequence++}.pdf`)
    await writeFile(sourcePath, input.encoded)
    const snapshot = await host.createDocumentSourceSnapshot({
      filePath: sourcePath,
      maxFileBytes: input.options.maxFileBytes,
      signal: input.signal
    })
    const { encoded: _encoded, ...request } = input
    try {
      return await host.recognizeDocument({ ...request, snapshot })
    } finally {
      await snapshot.release()
    }
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
        LIGHT_OCR_RUNTIME_DESCRIPTOR: '/tmp/injected.json',
        LIGHT_OCR_PDFIUM_MODULE: '/tmp/injected.cjs'
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
        runtimeDescriptorPath: '/private/runtime/native/runtime-descriptor.json',
        pdfiumModulePath: '/private/runtime/pdfium/index.cjs'
      }
    )

    expect(environment).toMatchObject({
      LIGHT_OCR_NODE_BINARY: '/private/runtime/native/light_ocr_node.node',
      LIGHT_OCR_RUNTIME_DESCRIPTOR: '/private/runtime/native/runtime-descriptor.json',
      LIGHT_OCR_PDFIUM_MODULE: '/private/runtime/pdfium/index.cjs',
      DEEPCHAT_LIGHT_OCR_HELPER: '1'
    })
  })

  it('materializes encoded native bytes once and passes trusted override paths to the helper', async () => {
    const nativePackageDir = path.join(tempDir, 'native-package')
    const nativeDir = path.join(nativePackageDir, 'native')
    const pdfiumDir = path.join(nativePackageDir, 'pdfium')
    const pdfiumFontsDir = path.join(pdfiumDir, 'fonts')
    await Promise.all([
      mkdir(nativeDir, { recursive: true }),
      mkdir(pdfiumFontsDir, { recursive: true })
    ])
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
    const pdfiumLoader = Buffer.from('module.exports = require("./pdfium.node")')
    const pdfiumAddon = Buffer.from('qualified-pdfium-addon')
    const pdfiumLibrary = Buffer.from('qualified-pdfium-library')
    const pdfiumFont = Buffer.from('qualified-pdfium-font')
    const pdfiumFontLicense = Buffer.from('qualified-pdfium-font-license')
    const pdfiumLoaderArtifact = {
      path: 'pdfium/index.cjs',
      bytes: pdfiumLoader.byteLength,
      sha256: hash(pdfiumLoader)
    }
    const pdfiumAddonArtifact = {
      path: 'pdfium/pdfium.node',
      bytes: pdfiumAddon.byteLength,
      sha256: hash(pdfiumAddon)
    }
    const pdfiumLibraryArtifact = {
      path: 'pdfium/libpdfium.dylib',
      bytes: pdfiumLibrary.byteLength,
      sha256: hash(pdfiumLibrary)
    }
    const pdfiumFontArtifact = {
      path: 'pdfium/fonts/NotoSansSC-Regular.otf',
      bytes: pdfiumFont.byteLength,
      sha256: hash(pdfiumFont)
    }
    const pdfiumFontLicenseArtifact = {
      path: 'pdfium/fonts/OFL.txt',
      bytes: pdfiumFontLicense.byteLength,
      sha256: hash(pdfiumFontLicense)
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
      writeFile(
        `${path.join(nativePackageDir, pdfiumAddonArtifact.path)}.gz.b64`,
        gzipSync(pdfiumAddon).toString('base64')
      ),
      writeFile(
        `${path.join(nativePackageDir, pdfiumLibraryArtifact.path)}.gz.b64`,
        gzipSync(pdfiumLibrary).toString('base64')
      ),
      writeFile(path.join(nativePackageDir, descriptorArtifact.path), descriptor),
      writeFile(path.join(nativePackageDir, pdfiumLoaderArtifact.path), pdfiumLoader),
      writeFile(path.join(nativePackageDir, pdfiumFontArtifact.path), pdfiumFont),
      writeFile(path.join(nativePackageDir, pdfiumFontLicenseArtifact.path), pdfiumFontLicense),
      writeFile(
        path.join(nativePackageDir, 'artifact-hashes.json'),
        JSON.stringify({
          files: [
            addonArtifact,
            runtimeArtifact,
            descriptorArtifact,
            pdfiumLoaderArtifact,
            pdfiumAddonArtifact,
            pdfiumLibraryArtifact,
            pdfiumFontArtifact,
            pdfiumFontLicenseArtifact
          ]
        })
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
    const materializedPdfium = spawnedEnvironments[0].LIGHT_OCR_PDFIUM_MODULE
    expect(materializedAddon).toBeTypeOf('string')
    expect(materializedDescriptor).toBeTypeOf('string')
    expect(materializedPdfium).toBeTypeOf('string')
    expect(spawnedEnvironments[1].LIGHT_OCR_NODE_BINARY).toBe(materializedAddon)
    expect(spawnedEnvironments[1].LIGHT_OCR_RUNTIME_DESCRIPTOR).toBe(materializedDescriptor)
    expect(spawnedEnvironments[1].LIGHT_OCR_PDFIUM_MODULE).toBe(materializedPdfium)
    await expect(readFile(materializedAddon!)).resolves.toEqual(addon)
    await expect(readFile(materializedDescriptor!)).resolves.toEqual(descriptor)
    await expect(readFile(materializedPdfium!)).resolves.toEqual(pdfiumLoader)
    await expect(
      readFile(path.join(path.dirname(materializedPdfium!), 'fonts/NotoSansSC-Regular.otf'))
    ).resolves.toEqual(pdfiumFont)
    await expect(
      readFile(path.join(path.dirname(materializedPdfium!), 'fonts/OFL.txt'))
    ).resolves.toEqual(pdfiumFontLicense)

    await host.close()
    await expect(readFile(materializedAddon!)).rejects.toThrow()
    await expect(readFile(materializedPdfium!)).rejects.toThrow()
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
    expect(host.getStatus().nodeVersion).toBe('v24.18.0')
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

  it('streams validated document pages in order and reports natural completion', async () => {
    const host = createHost()
    const pages: string[] = []

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond\fthird'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: (page) => {
        pages.push(page.lines[0] ?? '')
        return 'continue'
      }
    })

    expect(pages).toEqual(['first', 'second', 'third'])
    expect(outcome).toMatchObject({
      artifactTermination: 'request_complete',
      emittedPages: 3,
      generationOutputLimitReached: false,
      engine: {
        modelBundleId: bundleId,
        requestedProvider: 'cpu',
        strategy: 'bounded-960'
      }
    })
  })

  it('frames document messages split across arbitrary stdout chunks', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-fragmented-page' }
    })
    const pages: string[] = []

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: (page) => {
        pages.push(page.lines[0] ?? '')
        return 'continue'
      }
    })

    expect(pages).toEqual(['first', 'second'])
    expect(outcome.emittedPages).toBe(2)
  })

  it('stops document generation after the page consumer reaches its output limit', async () => {
    const host = createHost()
    const pages: string[] = []

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond\fthird'),
      backend: 'auto',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: (page) => {
        pages.push(page.lines[0] ?? '')
        return 'output_limit_reached'
      }
    })

    expect(pages).toEqual(['first'])
    expect(outcome).toMatchObject({
      artifactTermination: 'stopped_by_output_limit',
      emittedPages: 1,
      generationOutputLimitReached: true,
      engine: { requestedProvider: 'auto' }
    })
  })

  it('allows a document-stop acknowledgement to outlive cancellation grace', async () => {
    const host = createHost({
      cancelGraceMs: 10,
      documentStopTimeoutMs: 200,
      testEnvironment: { FAKE_OCR_DOCUMENT_STOP_DELAY_MS: '50' }
    })

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: () => 'output_limit_reached'
      })
    ).resolves.toMatchObject({
      artifactTermination: 'stopped_by_output_limit',
      emittedPages: 1,
      generationOutputLimitReached: true
    })
  })

  it('keeps stream completion separate from a raced output-limit stop', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-stop-race' }
    })
    const pages: string[] = []

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond\fthird'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: (page) => {
        pages.push(page.lines[0] ?? '')
        return 'output_limit_reached'
      }
    })

    expect(pages).toEqual(['first'])
    expect(outcome).toMatchObject({
      artifactTermination: 'request_complete',
      emittedPages: 3,
      generationOutputLimitReached: true,
      engine: { requestedProvider: 'cpu' }
    })
  })

  it('returns a deterministic resource-limited prefix only after a validated page', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-resource-after-page' }
    })
    const pages: string[] = []

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: (page) => {
        pages.push(page.lines[0] ?? '')
        return 'continue'
      }
    })

    expect(pages).toEqual(['first'])
    expect(outcome).toMatchObject({
      artifactTermination: 'resource_limited',
      emittedPages: 1,
      generationOutputLimitReached: false,
      resourceLimit: { code: 'resource_limit_exceeded' }
    })
  })

  it('records output-limit and resource-limit facts independently', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-resource-after-page' }
    })

    const outcome = await recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      onPage: () => 'output_limit_reached'
    })

    expect(outcome).toMatchObject({
      artifactTermination: 'resource_limited',
      emittedPages: 1,
      generationOutputLimitReached: true
    })
  })

  it('rejects a resource limit before the helper emits any document page', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-resource-before-page' }
    })

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: () => 'continue'
      })
    ).rejects.toMatchObject({
      code: 'helper_error',
      helperCode: 'resource_limit_exceeded'
    })
  })

  it('rejects non-resource helper errors even after document pages were emitted', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-error-after-page' }
    })
    const pages: string[] = []

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: (page) => {
          pages.push(page.lines[0] ?? '')
          return 'continue'
        }
      })
    ).rejects.toMatchObject({ code: 'helper_error', helperCode: 'runtime_failure' })
    expect(pages).toEqual(['first'])
  })

  it.each(['document-invalid-sequence', 'document-invalid-completion', 'document-invalid-model'])(
    'rejects invalid document protocol behavior: %s',
    async (behavior) => {
      const host = createHost({ testEnvironment: { FAKE_OCR_BEHAVIOR: behavior } })

      await expect(
        recognizeTestDocument(host, {
          encoded: Buffer.from('first\fsecond'),
          backend: 'cpu',
          strategy: 'bounded-960',
          options: documentOptions,
          onPage: () => 'continue'
        })
      ).rejects.toMatchObject({ code: 'invalid_protocol' })
    }
  )

  it('rejects document pages that exceed cumulative request pixel accounting', async () => {
    const host = createHost()

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: { ...documentOptions, maxTotalPixels: 30_000 },
        onPage: () => 'continue'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
  })

  it('uses an idle timeout that resets after each valid document page', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-hang-after-page' },
      documentIdleTimeoutMs: 50
    })
    const pages: string[] = []

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: (page) => {
          pages.push(page.lines[0] ?? '')
          return 'continue'
        }
      })
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(pages).toEqual(['first'])
  })

  it('enforces a total document timeout independently of page activity', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_DOCUMENT_PAGE_DELAY_MS: '30' },
      documentIdleTimeoutMs: 100,
      documentTotalTimeoutMs: 70
    })
    const pages: string[] = []

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('one\ftwo\fthree\ffour\ffive'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: (page) => {
          pages.push(page.lines[0] ?? '')
          return 'continue'
        }
      })
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.length).toBeLessThan(5)
  })

  it('rejects a malformed output-stop acknowledgement', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-invalid-stop-result' }
    })

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: () => 'output_limit_reached'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
  })

  it('rejects document output emitted after a completion terminal', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-page-after-completion' }
    })

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: () => 'output_limit_reached'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
  })

  it('cancels document recognition as control flow and discards the stream owner', async () => {
    const host = createHost({
      testEnvironment: { FAKE_OCR_BEHAVIOR: 'document-hang-after-page' }
    })
    const controller = new AbortController()

    const recognition = recognizeTestDocument(host, {
      encoded: Buffer.from('first\fsecond'),
      backend: 'cpu',
      strategy: 'bounded-960',
      options: documentOptions,
      signal: controller.signal,
      onPage: () => {
        controller.abort()
        return 'continue'
      }
    })

    await expect(recognition).rejects.toMatchObject({ code: 'cancelled' })
    expect(host.getStatus().pendingInputBytes).toBe(0)
  })

  it('does not replay a document stream after the helper crashes with emitted pages', async () => {
    const counter = path.join(tempDir, 'document-start-counter')
    const host = createHost({
      testEnvironment: {
        FAKE_OCR_BEHAVIOR: 'document-crash-after-page',
        FAKE_OCR_START_COUNTER: counter
      }
    })
    const pages: string[] = []

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first\fsecond'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions,
        onPage: (page) => {
          pages.push(page.lines[0] ?? '')
          return 'continue'
        }
      })
    ).rejects.toMatchObject({ code: 'unexpected_exit' })
    expect(pages).toEqual(['first'])
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('rejects invalid document resource options before starting the helper', async () => {
    const host = createHost()

    await expect(
      recognizeTestDocument(host, {
        encoded: Buffer.from('first'),
        backend: 'cpu',
        strategy: 'bounded-960',
        options: { ...documentOptions, maxPages: 101 },
        onPage: () => 'continue'
      })
    ).rejects.toMatchObject({ code: 'invalid_protocol' })
    expect(host.getStatus().pid).toBeNull()
  })

  it('copies document sources into a private bounded snapshot', async () => {
    const host = createHost()
    const sourcePath = path.join(tempDir, 'source.pdf')
    const source = Buffer.from('%PDF-private-snapshot')
    await writeFile(sourcePath, source)

    const snapshot = await host.createDocumentSourceSnapshot({
      filePath: sourcePath,
      maxFileBytes: source.byteLength
    })

    expect(snapshot.byteLength).toBe(source.byteLength)
    expect(snapshot.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'))
    await expect(readFile(snapshot.filePath)).resolves.toEqual(source)
    if (process.platform !== 'win32') {
      expect((await stat(snapshot.filePath)).mode & 0o777).toBe(0o600)
    }

    await snapshot.release()
    await snapshot.release()
    await expect(readFile(snapshot.filePath)).rejects.toThrow()
  })

  it('rejects document sources that exceed the bounded snapshot limit', async () => {
    const host = createHost()
    const sourcePath = path.join(tempDir, 'oversized.pdf')
    await writeFile(sourcePath, Buffer.alloc(5, 1))

    await expect(
      host.createDocumentSourceSnapshot({ filePath: sourcePath, maxFileBytes: 4 })
    ).rejects.toMatchObject({ code: 'input_too_large' })
  })

  it('serializes the private root creation for concurrent document snapshots', async () => {
    const host = createHost()
    const firstSourcePath = path.join(tempDir, 'first-source.pdf')
    const secondSourcePath = path.join(tempDir, 'second-source.pdf')
    await Promise.all([
      writeFile(firstSourcePath, '%PDF-first'),
      writeFile(secondSourcePath, '%PDF-second')
    ])

    const [first, second] = await Promise.all([
      host.createDocumentSourceSnapshot({
        filePath: firstSourcePath,
        maxFileBytes: 1_024
      }),
      host.createDocumentSourceSnapshot({
        filePath: secondSourcePath,
        maxFileBytes: 1_024
      })
    ])

    expect(path.dirname(first.filePath)).toBe(path.dirname(second.filePath))
    await Promise.all([first.release(), second.release()])
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
