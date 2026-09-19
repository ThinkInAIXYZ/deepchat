import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  LightOcrHelperServer,
  validateConfiguredPdfiumModule
} from '../../../src/main/ocr/lightOcrHelper'
import {
  LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS,
  LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  type LightOcrDocumentOptions
} from '../../../src/main/ocr/lightOcrProtocol'

const bundleId = 'ppocrv6-small-native-20260719.1'
const documentOptions: LightOcrDocumentOptions = {
  dpi: 150,
  pageRange: { start: 1, end: 100 },
  maxPages: 100,
  maxFileBytes: LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  maxPagePixels: LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  maxTotalPixels: LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS
}

function createEngine(close: () => Promise<void>) {
  return {
    info: {
      coreVersion: 'test-core',
      modelBundleId: bundleId,
      execution: {
        requestedProvider: 'cpu',
        sessions: {
          detection: {
            actualProviderChain: ['cpu'],
            precision: 'fp32',
            qualificationId: 'test-detection'
          },
          recognition: {
            actualProviderChain: ['cpu'],
            precision: 'fp32',
            qualificationId: 'test-recognition'
          }
        }
      }
    },
    recognizeEncoded: vi.fn(async () => {
      throw new Error('not used')
    }),
    close
  }
}

function collectMessages(stdout: PassThrough) {
  const messages: Array<Record<string, unknown>> = []
  let output = ''
  stdout.on('data', (chunk) => {
    output += chunk.toString()
    let newline = output.indexOf('\n')
    while (newline >= 0) {
      messages.push(JSON.parse(output.slice(0, newline)))
      output = output.slice(newline + 1)
      newline = output.indexOf('\n')
    }
  })
  return messages
}

describe('LightOcrHelperServer', () => {
  it('loads only a configured PDFium module inside the private runtime', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-pdfium-helper-test-'))
    try {
      const modulePath = path.join(tempRoot, 'pdfium', 'index.cjs')
      await mkdir(path.dirname(modulePath), { recursive: true })
      await writeFile(modulePath, 'module.exports = { loaded: true }')
      vi.stubEnv('LIGHT_OCR_PDFIUM_MODULE', modulePath)

      await expect(validateConfiguredPdfiumModule(tempRoot)).resolves.toBeUndefined()

      const outsidePath = path.join(path.dirname(tempRoot), 'outside-pdfium.cjs')
      await writeFile(outsidePath, 'module.exports = {}')
      vi.stubEnv('LIGHT_OCR_PDFIUM_MODULE', outsidePath)
      await expect(validateConfiguredPdfiumModule(tempRoot)).rejects.toMatchObject({
        code: 'package_load_failed'
      })
      await rm(outsidePath)
    } finally {
      vi.unstubAllEnvs()
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('uses the upstream auto provider policy without an incompatible session fallback', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const createEngineMock = vi.fn(async () => createEngine(async () => undefined))
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot: '/private-temp',
      createEngine: createEngineMock,
      stdin,
      stdout,
      stderr
    })
    let output = ''
    stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'configure-auto',
        backend: 'auto',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => output.includes('configure-auto')).toBe(true)

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: {
          provider: 'auto',
          sessionFallback: 'error',
          precision: 'auto',
          performanceHint: 'latency'
        }
      })
    )
    await server.shutdown()
  })

  it('does not create a second resident engine when closing the previous engine fails', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const messages: Array<{
      id?: string
      type: string
      error?: { code: string }
    }> = []
    let output = ''
    stdout.on('data', (chunk) => {
      output += chunk.toString()
      let newline = output.indexOf('\n')
      while (newline >= 0) {
        messages.push(JSON.parse(output.slice(0, newline)))
        output = output.slice(newline + 1)
        newline = output.indexOf('\n')
      }
    })

    const close = vi.fn(async () => {
      throw new Error('native close failed')
    })
    const engineFactory = vi.fn(async () => createEngine(close))
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot: '/private-temp',
      createEngine: engineFactory,
      stdin,
      stdout,
      stderr
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'first',
        backend: 'cpu',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'first')?.type).toBe('result')

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'second',
        backend: 'cpu',
        strategy: 'tiled-v1'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'second')?.type).toBe('error')

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'third',
        backend: 'cpu',
        strategy: 'tiled-v1'
      })}\n`
    )
    await expect.poll(() => messages.find((message) => message.id === 'third')?.type).toBe('error')

    expect(messages.find((message) => message.id === 'second')?.error.code).toBe(
      'engine_close_failed'
    )
    expect(messages.find((message) => message.id === 'third')?.error.code).toBe(
      'engine_close_failed'
    )
    expect(engineFactory).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    await server.shutdown()
  })

  it('reuses the configured engine for streaming PDF pages and acknowledges output stop', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-document-helper-test-'))
    const documentPath = path.join(tempRoot, 'document.pdf')
    await writeFile(documentPath, '%PDF-fake')
    const resolvedDocumentPath = await realpath(documentPath)
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const messages = collectMessages(stdout)
    const engine = createEngine(async () => undefined)
    const recognizeDocument = vi.fn(async function* (
      _source: string,
      options: LightOcrDocumentOptions & { signal: AbortSignal }
    ) {
      yield {
        index: 0,
        width: 100,
        height: 200,
        lines: [{ text: 'first page', confidence: 0.99 }],
        modelBundleId: bundleId,
        timingUs: { total: 3, decode: 1, ocr: 2 }
      }
      await new Promise((_, reject) => {
        if (options.signal.aborted) {
          reject(options.signal.reason)
          return
        }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true
        })
      })
    })
    const closeDocumentEngine = vi.fn(async () => undefined)
    const createDocumentEngine = vi.fn(
      async ({ engine: requestedEngine }: { engine: typeof engine }) => {
        expect(requestedEngine).toBe(engine)
        return { recognizeDocument, close: closeDocumentEngine }
      }
    )
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot,
      createEngine: vi.fn(async () => engine),
      createDocumentEngine,
      stdin,
      stdout,
      stderr
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'configure',
        backend: 'cpu',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => messages.some((message) => message.id === 'configure')).toBe(true)
    stdin.write(
      `${JSON.stringify({
        type: 'recognize_document',
        id: 'document',
        filePath: documentPath,
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions
      })}\n`
    )
    await expect.poll(() => messages.some((message) => message.type === 'document_page')).toBe(true)
    stdin.write(
      `${JSON.stringify({
        type: 'document_stop',
        id: 'stop',
        targetId: 'document'
      })}\n`
    )
    await expect
      .poll(() => messages.some((message) => message.type === 'request_complete'))
      .toBe(true)

    expect(recognizeDocument).toHaveBeenCalledWith(
      resolvedDocumentPath,
      expect.objectContaining({
        ...documentOptions,
        signal: expect.any(AbortSignal)
      })
    )
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'document_page',
          id: 'document',
          page: expect.objectContaining({
            index: 0,
            lines: ['first page']
          })
        }),
        { type: 'result', id: 'stop', data: { stopped: true } },
        { type: 'request_complete', id: 'document', emittedPages: 1 }
      ])
    )
    expect(closeDocumentEngine).toHaveBeenCalledTimes(1)

    await server.shutdown()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('preserves a structured upstream resource error after streamed document pages', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-document-helper-test-'))
    const documentPath = path.join(tempRoot, 'document.pdf')
    await writeFile(documentPath, '%PDF-fake')
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const messages = collectMessages(stdout)
    const engine = createEngine(async () => undefined)
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot,
      createEngine: vi.fn(async () => engine),
      createDocumentEngine: vi.fn(async () => ({
        async *recognizeDocument() {
          yield {
            index: 0,
            width: 100,
            height: 200,
            lines: [],
            modelBundleId: bundleId,
            timingUs: { total: 3, decode: 1, ocr: 2 }
          }
          throw Object.assign(new Error('pixel limit'), {
            code: 'resource_limit_exceeded'
          })
        },
        close: vi.fn(async () => {
          throw new Error('document cleanup failure')
        })
      })),
      stdin,
      stdout,
      stderr
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'configure',
        backend: 'cpu',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => messages.some((message) => message.id === 'configure')).toBe(true)
    stdin.write(
      `${JSON.stringify({
        type: 'recognize_document',
        id: 'document',
        filePath: documentPath,
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions
      })}\n`
    )
    await expect
      .poll(() => messages.some((message) => message.id === 'document' && message.type === 'error'))
      .toBe(true)

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'document_page', id: 'document' }),
        {
          type: 'error',
          id: 'document',
          error: { code: 'resource_limit_exceeded', message: 'pixel limit' }
        }
      ])
    )

    await server.shutdown()
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('does not disguise a resource error that races with an output stop', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-document-helper-test-'))
    const documentPath = path.join(tempRoot, 'document.pdf')
    await writeFile(documentPath, '%PDF-fake')
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const messages = collectMessages(stdout)
    const engine = createEngine(async () => undefined)
    const server = new LightOcrHelperServer({
      bundlePath: '/bundle',
      expectedBundleId: bundleId,
      tempRoot,
      createEngine: vi.fn(async () => engine),
      createDocumentEngine: vi.fn(async () => ({
        async *recognizeDocument(
          _source: string,
          options: LightOcrDocumentOptions & { signal: AbortSignal }
        ) {
          yield {
            index: 0,
            width: 100,
            height: 200,
            lines: [{ text: 'first page' }],
            modelBundleId: bundleId,
            timingUs: { total: 3, decode: 1, ocr: 2 }
          }
          await new Promise<void>((resolve) => {
            if (options.signal.aborted) resolve()
            else options.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          throw Object.assign(new Error('pixel limit won the race'), {
            code: 'resource_limit_exceeded'
          })
        },
        close: vi.fn(async () => undefined)
      })),
      stdin,
      stdout,
      stderr
    })
    server.start()

    stdin.write(
      `${JSON.stringify({
        type: 'configure',
        id: 'configure',
        backend: 'cpu',
        strategy: 'bounded-960'
      })}\n`
    )
    await expect.poll(() => messages.some((message) => message.id === 'configure')).toBe(true)
    stdin.write(
      `${JSON.stringify({
        type: 'recognize_document',
        id: 'document',
        filePath: documentPath,
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions
      })}\n`
    )
    await expect.poll(() => messages.some((message) => message.type === 'document_page')).toBe(true)
    stdin.write(
      `${JSON.stringify({
        type: 'document_stop',
        id: 'stop',
        targetId: 'document'
      })}\n`
    )
    await expect
      .poll(() => messages.some((message) => message.id === 'document' && message.type === 'error'))
      .toBe(true)

    expect(messages).toEqual(
      expect.arrayContaining([
        { type: 'result', id: 'stop', data: { stopped: true } },
        {
          type: 'error',
          id: 'document',
          error: {
            code: 'resource_limit_exceeded',
            message: 'pixel limit won the race'
          }
        }
      ])
    )

    await server.shutdown()
    await rm(tempRoot, { recursive: true, force: true })
  })
})
