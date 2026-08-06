import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliVersionRoute, type DeepchatRouteName } from '@shared/contracts/routes'
import type { JsonValue } from '@shared/contracts/json'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SCOPES,
  LOCAL_CONTROL_SURFACE_VERSION,
  LOCAL_CONTROL_METHOD_HEADER,
  LOCAL_CONTROL_UPLOAD_REQUEST_HEADER,
  LocalControlDescriptorSchema,
  LocalControlRpcResponseSchema,
  LocalControlUploadRequestSchema,
  type LocalControlDescriptor,
  type LocalControlRpcResponse,
  type LocalControlScope,
  type LocalControlUploadBinding
} from '@shared/contracts/localControl'
import { createCliRoutes } from '@/cli/routes'
import { CliServer, type CliServerDependencies, type CliUploadedInputFile } from '@/cli/server'
import { CliRequestError } from '@/cli/errors'
import {
  AgentCliTokenAuthority,
  type AgentCliRequestBeginResult,
  type AgentCliTokenClaims
} from '@/cli/agentTokenAuthority'
import type { CliRequestAdmission, CliRequestPolicyInput } from '@/cli/policy'
import type { CliSurfaceEntry } from '@/cli/surface'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { invokeLocalControlStream } from '../../../src/cli/transport'

type RpcResult = Readonly<{
  status: number
  connection: string | undefined
  body: LocalControlRpcResponse
}>

function grantAgentRequest(
  claims: AgentCliTokenClaims,
  release: () => void = () => undefined
): AgentCliRequestBeginResult {
  return {
    status: 'granted',
    grant: {
      claims,
      signal: new AbortController().signal,
      consumeBytes: () => true,
      release
    }
  }
}

const servers: CliServer[] = []
const temporaryDirectories: string[] = []

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-server-'))
  temporaryDirectories.push(directory)
  return directory
}

function rpcRequest(
  descriptor: LocalControlDescriptor,
  input: {
    token?: string
    id?: string
    method?: string
    params?: unknown
    protocolVersion?: number
    surfaceVersion?: number
  },
  options: {
    includeContentLength?: boolean
    methodHeader?: string | null
    sendBody?: boolean
  } = {}
): Promise<RpcResult> {
  const serialized = Buffer.from(
    JSON.stringify({
      protocolVersion: input.protocolVersion ?? LOCAL_CONTROL_PROTOCOL_VERSION,
      surfaceVersion: input.surfaceVersion ?? LOCAL_CONTROL_SURFACE_VERSION,
      id: input.id ?? 'request-1',
      method: input.method ?? 'cli.version',
      params: input.params ?? {}
    })
  )
  const headers: Record<string, string | number> = {
    authorization: `Bearer ${input.token ?? descriptor.token}`,
    'content-type': 'application/json'
  }
  const methodHeader =
    options.methodHeader === undefined ? (input.method ?? 'cli.version') : options.methodHeader
  if (methodHeader !== null) headers[LOCAL_CONTROL_METHOD_HEADER] = methodHeader
  if (options.includeContentLength !== false) headers['content-length'] = serialized.length

  return new Promise<RpcResult>((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath:
          descriptor.endpoint.kind === 'unix' ? descriptor.endpoint.path : descriptor.endpoint.name,
        path: '/v1/rpc',
        method: 'POST',
        headers
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('error', reject)
        response.once('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              connection:
                typeof response.headers.connection === 'string'
                  ? response.headers.connection
                  : undefined,
              body: LocalControlRpcResponseSchema.parse(
                JSON.parse(Buffer.concat(chunks).toString('utf8'))
              )
            })
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.once('error', reject)
    if (options.sendBody === false) {
      request.flushHeaders()
    } else if (options.includeContentLength === false) {
      const midpoint = Math.max(1, Math.floor(serialized.length / 2))
      request.write(serialized.subarray(0, midpoint))
      request.end(serialized.subarray(midpoint))
    } else {
      request.end(serialized)
    }
  })
}

function uploadRequest(
  descriptor: LocalControlDescriptor,
  input: {
    token?: string
    body: Buffer
    includeContentLength?: boolean
    signal?: AbortSignal
    binding?: LocalControlUploadBinding
    expectContinue?: boolean
    onContinue?: () => void
  }
): Promise<RpcResult> {
  const envelope = Buffer.from(
    JSON.stringify(
      LocalControlUploadRequestSchema.parse({
        protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
        surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
        id: 'request-upload',
        method: cliVersionRoute.name,
        params: {},
        upload: input.binding ?? {
          size: input.body.length,
          sha256: createHash('sha256').update(input.body).digest('hex')
        }
      })
    )
  ).toString('base64url')
  const headers: Record<string, string | number> = {
    authorization: `Bearer ${input.token ?? descriptor.token}`,
    'content-type': 'application/octet-stream',
    [LOCAL_CONTROL_UPLOAD_REQUEST_HEADER]: envelope
  }
  const expectsContinue = input.expectContinue !== false
  if (input.includeContentLength !== false) headers['content-length'] = input.body.length
  if (expectsContinue) headers.expect = '100-continue'

  return new Promise<RpcResult>((resolve, reject) => {
    let responseReceived = false
    const request = httpRequest(
      {
        socketPath:
          descriptor.endpoint.kind === 'unix' ? descriptor.endpoint.path : descriptor.endpoint.name,
        path: '/v1/upload',
        method: 'POST',
        signal: input.signal,
        headers
      },
      (response) => {
        responseReceived = true
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('error', reject)
        response.once('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              connection:
                typeof response.headers.connection === 'string'
                  ? response.headers.connection
                  : undefined,
              body: LocalControlRpcResponseSchema.parse(
                JSON.parse(Buffer.concat(chunks).toString('utf8'))
              )
            })
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.once('error', (error) => {
      if (!responseReceived) reject(error)
    })
    const sendBody = () => {
      if (input.includeContentLength === false) {
        const midpoint = Math.max(1, Math.floor(input.body.length / 2))
        request.write(input.body.subarray(0, midpoint))
        request.end(input.body.subarray(midpoint))
      } else {
        request.end(input.body)
      }
    }
    if (expectsContinue) {
      request.once('continue', () => {
        input.onContinue?.()
        sendBody()
      })
      request.flushHeaders()
    } else sendBody()
  })
}

function createUploadSurface(maxBodyBytes: number): ReadonlyMap<string, CliSurfaceEntry> {
  return new Map([
    [
      cliVersionRoute.name,
      {
        contract: cliVersionRoute,
        effect: 'compute',
        callers: ['human'],
        scopes: ['system:read'],
        transport: 'upload',
        approval: 'never',
        limits: { maxBodyBytes, timeoutMs: 5_000 }
      } satisfies CliSurfaceEntry
    ]
  ])
}

async function createTestServer(
  options: {
    beginAgentRequest?: (token: string) => AgentCliRequestBeginResult
    dispatchOutput?: (method: string) => unknown
    streamOutput?: Readonly<{
      events: readonly JsonValue[]
      contexts?: readonly (Readonly<{ runId?: string; cursor?: string }> | undefined)[]
      result: unknown
    }>
    dispatchStream?: NonNullable<CliServerDependencies['dispatchStream']>
    surface?: ReadonlyMap<string, CliSurfaceEntry>
    dispatchUpload?: (
      method: string,
      input: unknown,
      upload: CliUploadedInputFile,
      caller: CliRouteCaller,
      signal: AbortSignal
    ) => Promise<unknown>
    authorize?: (input: CliRequestPolicyInput) => Promise<CliRequestAdmission>
  } = {}
): Promise<{
  userDataPath: string
  server: CliServer
  descriptor: LocalControlDescriptor
  dispatch: ReturnType<typeof vi.fn>
  dispatchUpload: ReturnType<typeof vi.fn>
  authorize: ReturnType<typeof vi.fn>
}> {
  const userDataPath = await createTemporaryDirectory()
  let server: CliServer
  const routes = createCliRoutes({
    appVersion: '1.2.3',
    getStatus: () => server.getStatus(),
    hasTrustedRenderer: () => true
  })
  const dispatch = vi.fn(
    async (method: string, input: unknown, caller: CliRouteCaller): Promise<unknown> => {
      if (options.dispatchOutput) return options.dispatchOutput(method)
      const route = routes.get(method as DeepchatRouteName)
      if (!route) throw new Error(`Unknown test route: ${method}`)
      return await route(input, { caller })
    }
  )
  const dispatchUpload = vi.fn(options.dispatchUpload ?? (async () => ({})))
  const authorize = vi.fn(options.authorize ?? (async () => ({ release: () => undefined })))
  server = new CliServer({
    userDataPath,
    appVersion: '1.2.3',
    dispatch,
    ...(options.dispatchStream
      ? { dispatchStream: options.dispatchStream }
      : options.streamOutput
        ? {
            dispatchStream: async (
              method: string,
              _input: unknown,
              _caller: CliRouteCaller,
              _requestId: string,
              _signal: AbortSignal,
              emit: (
                event: string,
                data: JsonValue,
                context?: Readonly<{ runId?: string; cursor?: string }>
              ) => Promise<void>
            ) => {
              for (const [index, event] of (options.streamOutput?.events ?? []).entries()) {
                await emit(method, event, options.streamOutput?.contexts?.[index])
              }
              return options.streamOutput?.result
            }
          }
        : {}),
    beginAgentRequest: options.beginAgentRequest,
    dispatchUpload,
    ...(options.authorize ? { authorize } : {}),
    surface: options.surface,
    log: { warn: vi.fn(), error: vi.fn() }
  })
  servers.push(server)
  const descriptor = await server.start()
  return { userDataPath, server, descriptor, dispatch, dispatchUpload, authorize }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('CLI local transport', () => {
  it('serializes a stop that races with startup', async () => {
    const userDataPath = await createTemporaryDirectory()
    const server = new CliServer({
      userDataPath,
      appVersion: '1.2.3',
      dispatch: async () => ({})
    })
    servers.push(server)

    const starting = server.start()
    const stopping = server.stop()
    await Promise.all([starting, stopping])

    expect(server.getStatus().running).toBe(false)
    await expect(stat(server.getDescriptorPath())).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('discovers, authenticates, dispatches, and cleans up the server', async () => {
    const { server, descriptor, dispatch } = await createTestServer()
    const descriptorPath = server.getDescriptorPath()

    expect(
      LocalControlDescriptorSchema.parse(JSON.parse(await readFile(descriptorPath, 'utf8')))
    ).toEqual(descriptor)

    const response = await rpcRequest(descriptor, {})
    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        result: {
          appVersion: '1.2.3',
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
        }
      }
    })
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[2]).toMatchObject({
      kind: 'cli',
      principal: 'human',
      scopes: LOCAL_CONTROL_SCOPES
    })

    await server.stop()
    await expect(stat(descriptorPath)).rejects.toMatchObject({ code: 'ENOENT' })
    if (descriptor.endpoint.kind === 'unix') {
      await expect(stat(descriptor.endpoint.path)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('terminates active CLI streams when the desktop server stops', async () => {
    const dispatchStream = vi.fn(async () => await new Promise<never>(() => undefined))
    const { server, descriptor } = await createTestServer({ dispatchStream })
    const response = invokeLocalControlStream(
      {
        descriptor,
        token: descriptor.token,
        id: 'request-stream-shutdown',
        method: 'models.invoke',
        params: {
          providerId: 'provider-1',
          modelId: 'model-1',
          messages: [{ role: 'user', content: 'wait' }]
        },
        signal: new AbortController().signal
      },
      async () => undefined
    )
    await vi.waitFor(() => expect(dispatchStream).toHaveBeenCalledOnce())

    await server.stop()

    await expect(response).resolves.toMatchObject({
      ok: false,
      error: { code: 'unavailable', retriable: true }
    })
    expect(server.getStatus()).toMatchObject({
      running: false,
      activeConnections: 0,
      pendingRequests: 0,
      descriptorReady: false
    })
  })

  it('fails closed on invalid authentication without dispatching', async () => {
    const { descriptor, dispatch } = await createTestServer()

    const response = await rpcRequest(descriptor, { token: 'x'.repeat(43) })

    expect(response).toMatchObject({
      status: 401,
      connection: 'close',
      body: { ok: false, error: { code: 'authentication_failed' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('enforces protocol versions and the explicit surface before dispatch', async () => {
    const { descriptor, dispatch } = await createTestServer()

    const incompatible = await rpcRequest(descriptor, { protocolVersion: 2 })
    const hidden = await rpcRequest(descriptor, { method: 'settings.getSnapshot' })

    expect(incompatible).toMatchObject({
      status: 409,
      body: { ok: false, error: { code: 'unsupported_version' } }
    })
    expect(hidden).toMatchObject({
      status: 404,
      body: { ok: false, error: { code: 'not_found' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('requires the method header to match the typed request body', async () => {
    const { descriptor, dispatch } = await createTestServer()

    const missing = await rpcRequest(descriptor, {}, { methodHeader: null })
    const mismatched = await rpcRequest(
      descriptor,
      { method: 'cli.version' },
      { methodHeader: 'providers.listPublic' }
    )

    expect(missing).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_request' } }
    })
    expect(mismatched).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_request' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('rejects a declared JSON body against its route limit before reading it', async () => {
    const { descriptor, dispatch } = await createTestServer()

    const response = await rpcRequest(
      descriptor,
      { params: { padding: 'x'.repeat(20 * 1024) } },
      { sendBody: false }
    )

    expect(response).toMatchObject({
      status: 413,
      body: { ok: false, error: { code: 'body_too_large' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('reports invalid route output as an internal contract failure', async () => {
    const { descriptor } = await createTestServer({
      dispatchOutput: () => ({ appVersion: '' })
    })

    const response = await rpcRequest(descriptor, {})

    expect(response).toMatchObject({
      status: 500,
      body: { ok: false, error: { code: 'internal_error' } }
    })
  })

  it('releases policy admission after a route contract failure', async () => {
    const release = vi.fn()
    const { descriptor, authorize } = await createTestServer({
      authorize: async () => ({ release }),
      dispatchOutput: () => ({ appVersion: '' })
    })

    const response = await rpcRequest(descriptor, {})

    expect(response).toMatchObject({
      status: 500,
      body: { ok: false, error: { code: 'internal_error' } }
    })
    expect(authorize).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  it('requires Content-Length and never accepts implicit chunked RPC input', async () => {
    const { descriptor, dispatch } = await createTestServer()

    const response = await rpcRequest(descriptor, {}, { includeContentLength: false })

    expect(response).toMatchObject({
      status: 411,
      body: { ok: false, error: { code: 'invalid_request' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('validates upload policy before spilling and cleans the private input file', async () => {
    let uploadedPath = ''
    let uploadedBytes = Buffer.alloc(0)
    const { descriptor, userDataPath, dispatchUpload, authorize } = await createTestServer({
      surface: createUploadSurface(16),
      authorize: async () => ({ release: () => undefined }),
      dispatchUpload: async (_method, _input, upload) => {
        uploadedPath = upload.path
        uploadedBytes = await readFile(upload.path)
        return {
          appVersion: '1.2.3',
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
        }
      }
    })

    const response = await uploadRequest(descriptor, { body: Buffer.from('audio-input') })

    expect(response).toMatchObject({ status: 200, body: { ok: true } })
    expect(uploadedBytes).toEqual(Buffer.from('audio-input'))
    expect(dispatchUpload).toHaveBeenCalledOnce()
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        transportBinding: {
          size: 11,
          sha256: createHash('sha256').update('audio-input').digest('hex')
        }
      })
    )
    await expect(stat(uploadedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])
  })

  it('waits for upload approval before accepting file bytes', async () => {
    let resolveApproval!: (admission: CliRequestAdmission) => void
    const approval = new Promise<CliRequestAdmission>((resolve) => {
      resolveApproval = resolve
    })
    let continued = false
    const { descriptor, userDataPath, dispatchUpload, authorize } = await createTestServer({
      surface: createUploadSurface(16),
      authorize: async () => await approval,
      dispatchUpload: async () => ({
        appVersion: '1.2.3',
        protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
        surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
      })
    })

    const response = uploadRequest(descriptor, {
      body: Buffer.from('audio-input'),
      onContinue: () => {
        continued = true
      }
    })
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce())

    expect(continued).toBe(false)
    expect(dispatchUpload).not.toHaveBeenCalled()
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])

    resolveApproval({ release: () => undefined })

    await expect(response).resolves.toMatchObject({ status: 200, body: { ok: true } })
    expect(continued).toBe(true)
    expect(dispatchUpload).toHaveBeenCalledOnce()
  })

  it('rejects an upload without accepting file bytes when approval fails', async () => {
    let rejectApproval!: (reason: unknown) => void
    const approval = new Promise<CliRequestAdmission>((_resolve, reject) => {
      rejectApproval = reject
    })
    let continued = false
    const { descriptor, userDataPath, dispatchUpload, authorize } = await createTestServer({
      surface: createUploadSurface(16),
      authorize: async () => await approval
    })

    const response = uploadRequest(descriptor, {
      body: Buffer.from('audio-input'),
      onContinue: () => {
        continued = true
      }
    })
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce())
    rejectApproval(
      new CliRequestError('approval_denied', 'Approval was denied', {
        httpStatus: 403
      })
    )

    await expect(response).resolves.toMatchObject({
      status: 403,
      body: { ok: false, error: { code: 'approval_denied' } }
    })
    expect(continued).toBe(false)
    expect(dispatchUpload).not.toHaveBeenCalled()
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])
  })

  it('rejects upload bytes that do not match the approved size or digest', async () => {
    const { descriptor, dispatchUpload, authorize } = await createTestServer({
      surface: createUploadSurface(16),
      authorize: async () => ({ release: () => undefined })
    })
    const body = Buffer.from('audio-input')

    const wrongSize = await uploadRequest(descriptor, {
      body,
      binding: {
        size: 10,
        sha256: createHash('sha256').update(body).digest('hex')
      }
    })
    const wrongDigest = await uploadRequest(descriptor, {
      body,
      binding: {
        size: 11,
        sha256: createHash('sha256').update('other-bytes').digest('hex')
      }
    })

    expect(wrongSize).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_request' } }
    })
    expect(wrongDigest).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: 'invalid_request' } }
    })
    expect(authorize).toHaveBeenCalledOnce()
    expect(dispatchUpload).not.toHaveBeenCalled()
  })

  it('bounds chunked uploads cumulatively and removes partial spill files', async () => {
    const { descriptor, userDataPath, dispatchUpload } = await createTestServer({
      surface: createUploadSurface(8)
    })

    const response = await uploadRequest(descriptor, {
      body: Buffer.from('123456789'),
      includeContentLength: false
    })

    expect(response).toMatchObject({
      status: 413,
      body: { ok: false, error: { code: 'body_too_large' } }
    })
    expect(dispatchUpload).not.toHaveBeenCalled()
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])
  })

  it('releases cancelled upload requests when a domain adapter ignores the signal', async () => {
    const controller = new AbortController()
    const { descriptor, userDataPath, server, dispatchUpload } = await createTestServer({
      surface: createUploadSurface(16),
      dispatchUpload: async () => await new Promise<never>(() => undefined)
    })

    const response = uploadRequest(descriptor, {
      body: Buffer.from('audio-input'),
      signal: controller.signal
    })
    await vi.waitFor(() => expect(dispatchUpload).toHaveBeenCalledOnce())
    controller.abort()

    await expect(response).rejects.toBeDefined()
    await vi.waitFor(() => expect(server.getStatus().pendingRequests).toBe(0))
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])
  })

  it('denies Agent upload callers before reading their body', async () => {
    const agentToken = 'a'.repeat(43)
    const { descriptor, userDataPath, dispatchUpload } = await createTestServer({
      surface: createUploadSurface(16),
      beginAgentRequest: (token) =>
        token === agentToken
          ? grantAgentRequest({
              tokenId: 'token-id-conversation-1',
              conversationId: 'conversation-1',
              expiresAt: Date.now() + 60_000,
              scopes: ['system:read']
            })
          : { status: 'invalid' }
    })

    const response = await uploadRequest(descriptor, {
      token: agentToken,
      body: Buffer.from('audio-input')
    })

    expect(response).toMatchObject({
      status: 403,
      body: { ok: false, error: { code: 'permission_denied' } }
    })
    expect(dispatchUpload).not.toHaveBeenCalled()
    expect(await readdir(path.join(userDataPath, 'local-control', 'tmp'))).toEqual([])
  })

  it('rejects request bodies on artifact download endpoints', async () => {
    const { descriptor } = await createTestServer()
    const body = await new Promise<LocalControlRpcResponse>((resolve, reject) => {
      const request = httpRequest(
        {
          socketPath:
            descriptor.endpoint.kind === 'unix'
              ? descriptor.endpoint.path
              : descriptor.endpoint.name,
          path: '/v1/artifacts/abcdefghijklmnop',
          method: 'GET',
          headers: {
            authorization: `Bearer ${descriptor.token}`,
            'content-length': 1
          }
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.once('error', reject)
          response.once('end', () => {
            try {
              resolve(
                LocalControlRpcResponseSchema.parse(
                  JSON.parse(Buffer.concat(chunks).toString('utf8'))
                )
              )
            } catch (error) {
              reject(error)
            }
          })
        }
      )
      request.once('error', reject)
      request.end('x')
    })

    expect(body).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
  })

  it('applies agent expiry and scopes independently of the bearer token', async () => {
    let scopes: readonly LocalControlScope[] = ['models:read']
    let expiresAt = Date.now() - 1
    const release = vi.fn()
    const agentToken = 'g'.repeat(43)
    const { descriptor, dispatch } = await createTestServer({
      beginAgentRequest: (token) =>
        token === agentToken
          ? grantAgentRequest(
              {
                tokenId: 'token-id-conversation-1',
                conversationId: 'conversation-1',
                expiresAt,
                scopes
              },
              release
            )
          : { status: 'invalid' }
    })

    const expired = await rpcRequest(descriptor, { token: agentToken })
    expiresAt = Date.now() + 60_000
    const denied = await rpcRequest(descriptor, { token: agentToken })
    scopes = ['system:read']
    const allowed = await rpcRequest(descriptor, { token: agentToken })

    expect(expired).toMatchObject({
      status: 401,
      body: { ok: false, error: { code: 'authentication_failed' } }
    })
    expect(denied).toMatchObject({
      status: 403,
      body: { ok: false, error: { code: 'permission_denied' } }
    })
    expect(allowed).toMatchObject({ status: 200, body: { ok: true } })
    expect(release).toHaveBeenCalledTimes(3)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]?.[2]).toMatchObject({
      kind: 'cli',
      principal: 'agent',
      tokenId: 'token-id-conversation-1',
      conversationId: 'conversation-1',
      scopes: ['system:read']
    })
  })

  it('enforces Agent token call quotas before dispatch', async () => {
    const agentToken = 'h'.repeat(43)
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'token-id-conversation-1'
    })
    authority.issue({
      conversationId: 'conversation-1',
      scopes: ['system:read'],
      maxCalls: 1,
      maxBytes: 16 * 1024
    })
    const { descriptor, dispatch } = await createTestServer({
      beginAgentRequest: (token) => authority.beginRequest(token)
    })

    const allowed = await rpcRequest(descriptor, { token: agentToken })
    const exhausted = await rpcRequest(descriptor, { token: agentToken })

    expect(allowed).toMatchObject({ status: 200, body: { ok: true } })
    expect(exhausted).toMatchObject({
      status: 429,
      body: { ok: false, error: { code: 'rate_limited' } }
    })
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('stops reading when an Agent token byte quota is exhausted', async () => {
    const agentToken = 'i'.repeat(43)
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'token-id-conversation-1'
    })
    authority.issue({
      conversationId: 'conversation-1',
      scopes: ['system:read'],
      maxCalls: 2,
      maxBytes: 1
    })
    const { descriptor, dispatch } = await createTestServer({
      beginAgentRequest: (token) => authority.beginRequest(token)
    })

    const exhausted = await rpcRequest(descriptor, { token: agentToken })

    expect(exhausted).toMatchObject({
      status: 429,
      body: { ok: false, error: { code: 'rate_limited' } }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('cancels an active Agent request when its conversation token is revoked', async () => {
    const agentToken = 'j'.repeat(43)
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'token-id-conversation-1'
    })
    authority.issue({
      conversationId: 'conversation-1',
      scopes: ['system:read'],
      maxBytes: 16 * 1024
    })
    const { descriptor, dispatch } = await createTestServer({
      beginAgentRequest: (token) => authority.beginRequest(token),
      dispatchOutput: () => new Promise<never>(() => undefined)
    })

    const response = rpcRequest(descriptor, { token: agentToken })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    authority.revokeConversation('conversation-1')

    await expect(response).resolves.toMatchObject({
      status: 401,
      body: { ok: false, error: { code: 'authentication_failed' } }
    })
  })

  it('streams typed events and one terminal route result', async () => {
    const { server, descriptor } = await createTestServer({
      streamOutput: {
        events: [
          { type: 'text_delta', text: 'hello' },
          { type: 'stop', reason: 'complete' }
        ],
        contexts: [
          { runId: 'run-1', cursor: 'epoch-1:1' },
          { runId: 'run-1', cursor: 'epoch-1:2' }
        ],
        result: {
          providerId: 'provider-1',
          modelId: 'model-1',
          text: 'hello',
          finishReason: 'complete',
          latency: { queueMs: 0, firstEventMs: 1, firstTextMs: 1, totalMs: 10 }
        }
      }
    })
    const events: Array<{
      data: JsonValue
      runId?: string
      cursor?: string
    }> = []

    const result = await invokeLocalControlStream(
      {
        descriptor,
        token: descriptor.token,
        id: 'request-stream-1',
        method: 'models.invoke',
        params: {
          providerId: 'provider-1',
          modelId: 'model-1',
          messages: [{ role: 'user', content: 'hello' }]
        },
        signal: new AbortController().signal
      },
      async (event) =>
        events.push({
          data: event.data,
          ...(event.runId ? { runId: event.runId } : {}),
          ...(event.cursor ? { cursor: event.cursor } : {})
        })
    )

    expect(events).toEqual([
      {
        data: { type: 'text_delta', text: 'hello' },
        runId: 'run-1',
        cursor: 'epoch-1:1'
      },
      {
        data: { type: 'stop', reason: 'complete' },
        runId: 'run-1',
        cursor: 'epoch-1:2'
      }
    ])
    expect(result).toMatchObject({ ok: true, result: { text: 'hello' } })
    expect(server.getStatus().pendingRequests).toBe(0)
  })
})
