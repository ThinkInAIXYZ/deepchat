import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION,
  LOCAL_CONTROL_UPLOAD_REQUEST_HEADER,
  LocalControlUploadRequestSchema,
  createLocalControlSuccess,
  type LocalControlDescriptor,
  type LocalControlEndpoint,
  type LocalControlEventEnvelope
} from '@shared/contracts/localControl'
import {
  invokeLocalControlRpc,
  invokeLocalControlStream,
  invokeLocalControlUpload
} from '../../../src/cli/transport'

const servers: Server[] = []
const socketPaths: string[] = []
const temporaryDirectories: string[] = []

function createEndpoint(): LocalControlEndpoint {
  if (process.platform === 'win32') {
    return { kind: 'pipe', name: `\\\\.\\pipe\\deepchat-cli-test-${randomUUID()}` }
  }
  const socketPath = `/tmp/deepchat-cli-${randomUUID()}.sock`
  socketPaths.push(socketPath)
  return { kind: 'unix', path: socketPath }
}

async function listen(
  listener: RequestListener,
  checkContinueListener?: RequestListener
): Promise<LocalControlDescriptor> {
  const endpoint = createEndpoint()
  const server = createServer(listener)
  if (checkContinueListener) server.on('checkContinue', checkContinueListener)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint.kind === 'unix' ? endpoint.path : endpoint.name, resolve)
  })
  return {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
    appVersion: '1.2.3',
    endpoint,
    pid: process.pid,
    token: 't'.repeat(43),
    startedAt: Date.now()
  }
}

async function invoke(descriptor: LocalControlDescriptor) {
  return await invokeLocalControlRpc({
    descriptor,
    token: descriptor.token,
    id: 'request-1',
    method: 'cli.version',
    params: {},
    signal: new AbortController().signal
  })
}

async function invokeStream(
  descriptor: LocalControlDescriptor,
  onEvent: (event: LocalControlEventEnvelope) => void | Promise<void>
) {
  return await invokeLocalControlStream(
    {
      descriptor,
      token: descriptor.token,
      id: 'request-1',
      method: 'models.invoke',
      params: {
        providerId: 'provider-1',
        modelId: 'model-1',
        messages: [{ role: 'user', content: 'hello' }]
      },
      signal: new AbortController().signal
    },
    onEvent
  )
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
  await Promise.all(socketPaths.splice(0).map((socketPath) => rm(socketPath, { force: true })))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('CLI response transport', () => {
  it('rejects a response envelope for another request', async () => {
    const descriptor = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(createLocalControlSuccess('request-2', {})))
    })

    await expect(invoke(descriptor)).rejects.toMatchObject({
      code: 'internal_error',
      exitCode: 8
    })
  })

  it('rejects an oversized declared response before buffering it', async () => {
    const descriptor = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('content-length', 16 * 1024 * 1024 + 1)
      response.flushHeaders()
    })

    await expect(invoke(descriptor)).rejects.toMatchObject({
      code: 'internal_error',
      exitCode: 8
    })
  })

  it('requires HTTP status and the typed envelope to agree', async () => {
    const descriptor = await listen((_request, response) => {
      response.statusCode = 500
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(createLocalControlSuccess('request-1', {})))
    })

    await expect(invoke(descriptor)).rejects.toMatchObject({
      code: 'internal_error',
      exitCode: 8
    })
  })

  it('preserves cancellation after JSON response headers arrive', async () => {
    const descriptor = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.flushHeaders()
    })
    const controller = new AbortController()
    const result = invokeLocalControlRpc({
      descriptor,
      token: descriptor.token,
      id: 'request-1',
      method: 'cli.version',
      params: {},
      signal: controller.signal
    })
    controller.abort(new Error('cancelled-by-test'))

    await expect(result).rejects.toMatchObject({ message: 'cancelled-by-test' })
  })

  it('consumes ordered NDJSON events before the terminal envelope', async () => {
    const descriptor = await listen((_request, response) => {
      response.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
      response.end(
        [
          {
            protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
            surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
            sequence: 0,
            timestamp: Date.now(),
            requestId: 'request-1',
            event: 'models.invoke',
            data: { type: 'text_delta', text: 'hello' }
          },
          createLocalControlSuccess('request-1', {
            providerId: 'provider-1',
            modelId: 'model-1',
            text: 'hello',
            finishReason: 'complete',
            latency: { queueMs: 0, firstEventMs: 1, firstTextMs: 1, totalMs: 10 }
          })
        ]
          .map((record) => JSON.stringify(record))
          .join('\n') + '\n'
      )
    })
    const events: LocalControlEventEnvelope[] = []

    const result = await invokeStream(descriptor, async (event) => events.push(event))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ sequence: 0, data: { text: 'hello' } })
    expect(result).toMatchObject({ ok: true, result: { text: 'hello' } })
  })

  it('rejects out-of-order stream events', async () => {
    const descriptor = await listen((_request, response) => {
      response.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
      response.end(
        `${JSON.stringify({
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
          sequence: 1,
          timestamp: Date.now(),
          requestId: 'request-1',
          event: 'models.invoke',
          data: { type: 'text_delta', text: 'hello' }
        })}\n`
      )
    })

    await expect(invokeStream(descriptor, async () => undefined)).rejects.toMatchObject({
      code: 'internal_error',
      exitCode: 8
    })
  })

  it('uploads a stable regular-file snapshot with a typed envelope header', async () => {
    let receivedBody = Buffer.alloc(0)
    let receivedEnvelope: unknown
    let receivedExpectHeader: string | undefined
    let bytesBeforeContinue = 0
    let continueSent = false
    const handleUpload: RequestListener = (request, response) => {
      const rawEnvelope = request.headers[LOCAL_CONTROL_UPLOAD_REQUEST_HEADER]
      receivedEnvelope = LocalControlUploadRequestSchema.parse(
        JSON.parse(Buffer.from(String(rawEnvelope), 'base64url').toString('utf8'))
      )
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.once('end', () => {
        receivedBody = Buffer.concat(chunks)
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(createLocalControlSuccess('request-1', { accepted: true })))
      })
    }
    const descriptor = await listen(handleUpload, (request, response) => {
      receivedExpectHeader = request.headers.expect
      request.on('data', (chunk: Buffer) => {
        if (!continueSent) bytesBeforeContinue += chunk.length
      })
      setImmediate(() => {
        continueSent = true
        response.writeContinue()
        handleUpload(request, response)
      })
    })
    const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-upload-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'sample.wav')
    await writeFile(filePath, 'audio-bytes')

    const result = await invokeLocalControlUpload({
      descriptor,
      token: descriptor.token,
      id: 'request-1',
      method: 'audio.transcribeUpload',
      params: { mimeType: 'audio/wav', filename: 'sample.wav' },
      signal: new AbortController().signal,
      filePath,
      maxBytes: 64
    })

    expect(result).toMatchObject({ ok: true, result: { accepted: true } })
    expect(receivedExpectHeader).toBe('100-continue')
    expect(bytesBeforeContinue).toBe(0)
    expect(receivedEnvelope).toMatchObject({
      id: 'request-1',
      method: 'audio.transcribeUpload',
      params: { filename: 'sample.wav' },
      upload: {
        size: 11,
        sha256: createHash('sha256').update('audio-bytes').digest('hex')
      }
    })
    expect(receivedBody).toEqual(Buffer.from('audio-bytes'))
  })

  it.runIf(process.platform !== 'win32')(
    'rejects symlink upload sources before connecting',
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-upload-link-'))
      temporaryDirectories.push(directory)
      const targetPath = path.join(directory, 'target.wav')
      const linkPath = path.join(directory, 'link.wav')
      await writeFile(targetPath, 'audio-bytes')
      await symlink(targetPath, linkPath)

      await expect(
        invokeLocalControlUpload({
          descriptor: {
            protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
            surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
            appVersion: '1.2.3',
            endpoint: { kind: 'unix', path: '/tmp/unused-deepchat.sock' },
            pid: process.pid,
            token: 't'.repeat(43),
            startedAt: Date.now()
          },
          token: 't'.repeat(43),
          id: 'request-1',
          method: 'audio.transcribeUpload',
          params: {},
          signal: new AbortController().signal,
          filePath: linkPath,
          maxBytes: 64
        })
      ).rejects.toMatchObject({ code: 'invalid_request', exitCode: 2 })
    }
  )
})
