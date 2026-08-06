import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeepchatRouteName } from '@shared/contracts/routes'
import type { JsonValue } from '@shared/contracts/json'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  LocalControlEventEnvelopeSchema,
  LocalControlRpcResponseSchema,
  type LocalControlDescriptor
} from '@shared/contracts/localControl'
import { createCliRoutes } from '@/cli/routes'
import { CliServer } from '@/cli/server'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { runCli } from '../../../src/cli/run'

const servers: CliServer[] = []
const temporaryDirectories: string[] = []

const testDescriptor: LocalControlDescriptor = {
  protocolVersion: 1,
  surfaceVersion: 1,
  appVersion: '9.8.7',
  endpoint: { kind: 'unix', path: '/tmp/deepchat-test.sock' },
  pid: 1,
  token: 'h'.repeat(43),
  startedAt: 1
}

function captureOutput(): { stream: NodeJS.WriteStream; read(): string } {
  let value = ''
  return {
    stream: {
      write: (chunk: string | Uint8Array) => {
        value += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        return true
      }
    } as NodeJS.WriteStream,
    read: () => value
  }
}

async function createClientServer(
  options: {
    hang?: boolean
    hangStream?: boolean
    stream?: Readonly<{ events: readonly JsonValue[]; result: unknown }>
  } = {}
): Promise<{
  userDataPath: string
  server: CliServer
  dispatch: ReturnType<typeof vi.fn>
  dispatchStream: ReturnType<typeof vi.fn>
}> {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'deepchat-cli-client-'))
  temporaryDirectories.push(userDataPath)
  let server: CliServer
  const routes = createCliRoutes({
    appVersion: '9.8.7',
    getStatus: () => server.getStatus(),
    hasTrustedRenderer: () => true
  })
  const dispatch = vi.fn(
    async (method: string, input: unknown, caller: CliRouteCaller): Promise<unknown> => {
      if (options.hang) return await new Promise<never>(() => undefined)
      const route = routes.get(method as DeepchatRouteName)
      if (!route) throw new Error(`Unknown test route: ${method}`)
      return await route(input, { caller })
    }
  )
  const dispatchStream = vi.fn(
    async (
      method: string,
      _input: unknown,
      _caller: CliRouteCaller,
      _requestId: string,
      _signal: AbortSignal,
      emit: (event: string, data: JsonValue) => Promise<void>
    ) => {
      if (options.hangStream) return await new Promise<never>(() => undefined)
      for (const event of options.stream?.events ?? []) await emit(method, event)
      return options.stream?.result
    }
  )
  server = new CliServer({
    userDataPath,
    appVersion: '9.8.7',
    dispatch,
    ...(options.stream || options.hangStream
      ? {
          dispatchStream
        }
      : {}),
    log: { warn: vi.fn(), error: vi.fn() }
  })
  servers.push(server)
  await server.start()
  return { userDataPath, server, dispatch, dispatchStream }
}

function runWithCapturedOutput(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  stdin?: NodeJS.ReadableStream
): {
  result: Promise<number>
  stdout: ReturnType<typeof captureOutput>
  stderr: ReturnType<typeof captureOutput>
  signalHost: EventEmitter
} {
  const stdout = captureOutput()
  const stderr = captureOutput()
  const signalHost = new EventEmitter()
  return {
    result: runCli(argv, {
      env,
      stdout: stdout.stream,
      stderr: stderr.stream,
      ...(stdin ? { stdin } : {}),
      signalHost: signalHost as unknown as NodeJS.Process,
      randomId: () => 'request-1',
      forceExit: vi.fn()
    }),
    stdout,
    stderr,
    signalHost
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('bundled CLI client', () => {
  it('renders top-level help without discovering a running app', async () => {
    const invocation = runWithCapturedOutput(['help'], {})

    await expect(invocation.result).resolves.toBe(0)
    expect(invocation.stdout.read()).toContain('Usage: deepchat <domain> <verb> [options]')
    expect(invocation.stderr.read()).toBe('')
  })

  it('keeps usage failures machine-readable when a post-command mode is valid', async () => {
    const invocation = runWithCapturedOutput(['system', 'status', '--json', '--unknown'], {})

    await expect(invocation.result).resolves.toBe(2)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'invalid_request' }
      }
    )
    expect(invocation.stderr.read()).toBe('')
  })

  it('keeps unexpected boundary failures inside the machine error contract', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()

    await expect(
      runCli(['system', 'status', '--json'], {
        env: {},
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => {
          throw new Error('x'.repeat(5_000))
        }
      })
    ).resolves.toBe(8)

    const response = LocalControlRpcResponseSchema.parse(JSON.parse(stdout.read()))
    expect(response).toMatchObject({ ok: false, error: { code: 'internal_error' } })
    expect(response.ok ? '' : response.error.message).toHaveLength(4_096)
    expect(stderr.read()).toBe('')
  })

  it('discovers the running app and renders human output', async () => {
    const { userDataPath, dispatch } = await createClientServer()
    const invocation = runWithCapturedOutput(['system', 'version'], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })

    await expect(invocation.result).resolves.toBe(0)
    expect(invocation.stdout.read()).toContain('DeepChat 9.8.7')
    expect(invocation.stdout.read()).toContain('Protocol 1, surface 1')
    expect(invocation.stderr.read()).toBe('')
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('emits exactly one canonical envelope in JSON mode', async () => {
    const { userDataPath } = await createClientServer()
    const invocation = runWithCapturedOutput(['system', 'status', '--json'], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })

    await expect(invocation.result).resolves.toBe(0)
    const lines = invocation.stdout.read().trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(lines[0]))).toMatchObject({
      id: 'request-1',
      ok: true,
      result: { running: true }
    })
    expect(invocation.stderr.read()).toBe('')
  })

  it('never falls back to the descriptor when Agent token selection fails', async () => {
    const { userDataPath, dispatch } = await createClientServer()
    const invocation = runWithCapturedOutput(['system', 'status', '--json'], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath,
      [LOCAL_CONTROL_AGENT_TOKEN_ENV]: ''
    })

    await expect(invocation.result).resolves.toBe(4)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'authentication_failed' }
      }
    )
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('aborts the socket and returns the stable timeout exit code', async () => {
    const { userDataPath } = await createClientServer({ hang: true })
    const invocation = runWithCapturedOutput(['system', 'status', '--json', '--timeout', '10'], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })

    await expect(invocation.result).resolves.toBe(7)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'timeout' }
      }
    )
  })

  it('cancels once on SIGINT and returns the stable cancellation code', async () => {
    const { userDataPath } = await createClientServer({ hang: true })
    const invocation = runWithCapturedOutput(['system', 'status', '--json'], {
      DEEPCHAT_E2E_USER_DATA_DIR: userDataPath
    })
    invocation.signalHost.emit('SIGINT')

    await expect(invocation.result).resolves.toBe(7)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'cancelled' }
      }
    )
  })

  it('renders streamed model text once and preserves JSONL event records', async () => {
    const stream = {
      events: [
        { type: 'text_delta', text: 'Hel' },
        { type: 'text_delta', text: 'lo' },
        { type: 'stop', reason: 'complete' }
      ],
      result: {
        providerId: 'provider-1',
        modelId: 'model-1',
        text: 'Hello',
        finishReason: 'complete',
        latency: { queueMs: 0, firstEventMs: 1, firstTextMs: 1, totalMs: 10 }
      }
    } as const
    const { userDataPath } = await createClientServer({ stream })
    const environment = { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }

    const textInvocation = runWithCapturedOutput(
      ['model', 'invoke', '--provider', 'provider-1', '--model', 'model-1', '--prompt', 'hello'],
      environment
    )
    await expect(textInvocation.result).resolves.toBe(0)
    expect(textInvocation.stdout.read()).toBe('Hello\n')

    const jsonlInvocation = runWithCapturedOutput(
      [
        'model',
        'invoke',
        '--provider',
        'provider-1',
        '--model',
        'model-1',
        '--prompt',
        'hello',
        '--jsonl'
      ],
      environment
    )
    await expect(jsonlInvocation.result).resolves.toBe(0)
    const records = jsonlInvocation.stdout
      .read()
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records).toHaveLength(4)
    expect(records.slice(0, 3).map((record) => record.sequence)).toEqual([0, 1, 2])
    expect(records[3]).toMatchObject({ ok: true, result: { text: 'Hello' } })
  })

  it('starts a durable Agent run with bounded stdin and prints its recovery identity', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeRpc = vi.fn(async (invocation) =>
      LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: {
          runId: 'run-1',
          sessionId: 'run-1',
          status: 'generating',
          requestId: 'agent-request-1',
          messageId: 'message-1',
          createdAt: 1_000
        }
      })
    )

    await expect(
      runCli(['agent', 'run', '--stdin', '--provider', 'provider-1', '--model', 'model-1'], {
        env: {},
        stdin: Readable.from(['Run the benchmark']),
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeRpc
      })
    ).resolves.toBe(0)

    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'sessions.runDetached',
        params: {
          prompt: 'Run the benchmark',
          providerId: 'provider-1',
          modelId: 'model-1'
        }
      })
    )
    expect(stdout.read()).toContain('Run run-1 started (generating)')
    expect(stdout.read()).toContain('deepchat run watch --run run-1')
    expect(stderr.read()).toBe('')
  })

  it('validates targeted run events and preserves their resume cursors in JSONL', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeStream = vi.fn(async (invocation, onEvent) => {
      await onEvent(
        LocalControlEventEnvelopeSchema.parse({
          protocolVersion: 1,
          surfaceVersion: 1,
          sequence: 0,
          timestamp: 1_000,
          requestId: invocation.id,
          runId: 'run-1',
          cursor: 'epoch-1:7',
          event: 'sessions.status.changed',
          data: {
            sessionId: 'run-1',
            status: 'idle',
            version: 2,
            internalSecret: 'do-not-publish'
          }
        })
      )
      return LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: { runId: 'run-1', lastCursor: 'epoch-1:7' }
      })
    })

    await expect(
      runCli(['run', 'watch', '--run', 'run-1', '--jsonl'], {
        env: {},
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeStream
      })
    ).resolves.toBe(0)

    const records = stdout
      .read()
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      event: 'sessions.status.changed',
      runId: 'run-1',
      cursor: 'epoch-1:7'
    })
    expect(records[1]).toMatchObject({
      ok: true,
      result: { runId: 'run-1', lastCursor: 'epoch-1:7' }
    })
    expect(stdout.read()).not.toContain('do-not-publish')
    expect(stderr.read()).toBe('')
  })

  it('rejects untargeted run stream records before writing attacker-controlled data', async () => {
    const stdout = captureOutput()
    const invokeStream = vi.fn(async (invocation, onEvent) => {
      await onEvent(
        LocalControlEventEnvelopeSchema.parse({
          protocolVersion: 1,
          surfaceVersion: 1,
          sequence: 0,
          timestamp: 1_000,
          requestId: invocation.id,
          event: 'chat.stream.failed',
          data: {
            requestId: 'agent-request-1',
            sessionId: 'other-run',
            messageId: 'message-1',
            failedAt: 1_000,
            error: 'untrusted'
          }
        })
      )
      throw new Error('unreachable')
    })

    await expect(
      runCli(['run', 'watch', '--run', 'run-1', '--jsonl'], {
        env: {},
        stdout: stdout.stream,
        stderr: captureOutput().stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeStream
      })
    ).resolves.toBe(8)

    const records = stdout.read().trimEnd().split('\n')
    expect(records).toHaveLength(1)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(records[0]))).toMatchObject({
      ok: false,
      error: { code: 'internal_error' }
    })
    expect(stdout.read()).not.toContain('untrusted')
  })

  it('keeps typed internal events outside the public run stream allowlist', async () => {
    const stdout = captureOutput()
    const invokeStream = vi.fn(async (invocation, onEvent) => {
      await onEvent(
        LocalControlEventEnvelopeSchema.parse({
          protocolVersion: 1,
          surfaceVersion: 1,
          sequence: 0,
          timestamp: 1_000,
          requestId: invocation.id,
          runId: 'run-1',
          cursor: 'epoch-1:8',
          event: 'approvals.closed',
          data: {
            requestId: 'approval-request-1234',
            reason: 'approved'
          }
        })
      )
      throw new Error('unreachable')
    })

    await expect(
      runCli(['run', 'watch', '--run', 'run-1', '--jsonl'], {
        env: {},
        stdout: stdout.stream,
        stderr: captureOutput().stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeStream
      })
    ).resolves.toBe(8)

    const response = LocalControlRpcResponseSchema.parse(JSON.parse(stdout.read()))
    expect(response).toMatchObject({ ok: false, error: { code: 'internal_error' } })
    expect(stdout.read()).not.toContain('approvals.closed')
  })

  it('neutralizes terminal control characters in human model output', async () => {
    const stdout = captureOutput()
    const invokeStream = vi.fn(async (invocation, onEvent) => {
      await onEvent(
        LocalControlEventEnvelopeSchema.parse({
          protocolVersion: 1,
          surfaceVersion: 1,
          sequence: 0,
          timestamp: 1_000,
          requestId: invocation.id,
          event: 'models.invoke',
          data: { type: 'text_delta', text: '\u001b]52;c;c2VjcmV0\u0007safe\r\u202e' }
        })
      )
      return LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: {
          providerId: 'provider-1',
          modelId: 'model-1',
          text: 'safe',
          finishReason: 'complete',
          latency: { queueMs: 0, firstEventMs: 1, firstTextMs: 1, totalMs: 10 }
        }
      })
    })

    await expect(
      runCli(
        ['model', 'invoke', '--provider', 'provider-1', '--model', 'model-1', '--prompt', 'hello'],
        {
          env: {},
          stdout: stdout.stream,
          stderr: captureOutput().stream,
          randomId: () => 'request-1',
          loadDescriptor: async () => testDescriptor,
          invokeStream
        }
      )
    ).resolves.toBe(0)

    expect(stdout.read()).toContain('safe')
    expect(
      Array.from(stdout.read()).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return (
          codePoint === 0x0d ||
          (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          (codePoint >= 0x202a && codePoint <= 0x202e)
        )
      })
    ).toBe(false)
  })

  it('cancels a stream promptly even when its provider ignores the signal', async () => {
    const { userDataPath, server } = await createClientServer({ hangStream: true })
    const invocation = runWithCapturedOutput(
      [
        'model',
        'invoke',
        '--provider',
        'provider-1',
        '--model',
        'model-1',
        '--prompt',
        'hello',
        '--json',
        '--timeout',
        '10'
      ],
      { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }
    )

    await expect(invocation.result).resolves.toBe(7)
    expect(LocalControlRpcResponseSchema.parse(JSON.parse(invocation.stdout.read()))).toMatchObject(
      {
        ok: false,
        error: { code: 'timeout' }
      }
    )
    await vi.waitFor(() => expect(server.getStatus().pendingRequests).toBe(0))
  })

  it('maps media stdin and renders artifact retrieval instructions', async () => {
    const artifact = {
      id: 'artifact_identifier_123',
      requestId: 'request-1',
      owner: 'human',
      mimeType: 'image/png',
      size: 5,
      sha256: 'a'.repeat(64),
      filename: 'generated-image-1.png',
      createdAt: 1_000,
      expiresAt: 2_000
    } as const
    const stream = {
      events: [
        { type: 'started', providerId: 'provider-1', modelId: 'image-1' },
        { type: 'artifact', index: 0, artifact }
      ],
      result: {
        providerId: 'provider-1',
        modelId: 'image-1',
        artifacts: [artifact],
        durationMs: 25
      }
    } as const
    const { userDataPath, dispatchStream } = await createClientServer({ stream })
    const invocation = runWithCapturedOutput(
      ['image', 'generate', '--provider', 'provider-1', '--model', 'image-1', '--stdin'],
      { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath },
      Readable.from(['a lighthouse'])
    )

    await expect(invocation.result).resolves.toBe(0)
    expect(invocation.stdout.read()).toContain('Generated 1 image artifact in 25ms')
    expect(invocation.stdout.read()).toContain(
      'deepchat artifact get --id artifact_identifier_123 --out generated-image-1.png'
    )
    expect(dispatchStream).toHaveBeenCalledWith(
      'images.generate',
      {
        providerId: 'provider-1',
        modelId: 'image-1',
        prompt: 'a lighthouse'
      },
      expect.objectContaining({ principal: 'human' }),
      'request-1',
      expect.any(AbortSignal),
      expect.any(Function)
    )
  })

  it('rejects invalid media events before emitting JSONL records', async () => {
    const stream = {
      events: [{ type: 'artifact', index: -1, artifact: {} }],
      result: {}
    } as const
    const { userDataPath } = await createClientServer({ stream })
    const invocation = runWithCapturedOutput(
      [
        'audio',
        'speak',
        '--provider',
        'provider-1',
        '--model',
        'tts-1',
        '--text',
        'hello',
        '--jsonl'
      ],
      { DEEPCHAT_E2E_USER_DATA_DIR: userDataPath }
    )

    await expect(invocation.result).resolves.toBe(8)
    const records = invocation.stdout
      .read()
      .trimEnd()
      .split('\n')
      .map((line) => LocalControlRpcResponseSchema.parse(JSON.parse(line)))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ ok: false, error: { code: 'internal_error' } })
  })

  it('uploads human audio input with only typed metadata in the RPC envelope', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeUpload = vi.fn(async (invocation) =>
      LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: {
          providerId: 'provider-1',
          modelId: 'whisper-1',
          text: 'meeting transcript',
          truncated: false,
          inputBytes: 10,
          mimeType: 'audio/mpeg',
          durationMs: 25
        }
      })
    )

    await expect(
      runCli(
        [
          'audio',
          'transcribe',
          '--provider',
          'provider-1',
          '--model',
          'whisper-1',
          '--file',
          '/private/input/meeting.mp3'
        ],
        {
          env: {},
          stdout: stdout.stream,
          stderr: stderr.stream,
          randomId: () => 'request-1',
          loadDescriptor: async () => testDescriptor,
          invokeUpload
        }
      )
    ).resolves.toBe(0)

    expect(stdout.read()).toBe('meeting transcript\n')
    expect(stderr.read()).toBe('')
    expect(invokeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'audio.transcribeUpload',
        params: {
          providerId: 'provider-1',
          modelId: 'whisper-1',
          mimeType: 'audio/mpeg',
          filename: 'meeting.mp3'
        },
        filePath: '/private/input/meeting.mp3',
        maxBytes: 25 * 1024 * 1024
      })
    )
  })

  it('rejects Agent --file input before the upload transport can open it', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeUpload = vi.fn()

    await expect(
      runCli(['ocr', 'extract', '--file', '/private/input/scan.png', '--json'], {
        env: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: 'a'.repeat(43) },
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeUpload
      })
    ).resolves.toBe(4)

    expect(LocalControlRpcResponseSchema.parse(JSON.parse(stdout.read()))).toMatchObject({
      ok: false,
      error: { code: 'permission_denied' }
    })
    expect(stderr.read()).toBe('')
    expect(invokeUpload).not.toHaveBeenCalled()
  })

  it('reads provider credentials from bounded stdin instead of argv', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeRpc = vi.fn(async (invocation) =>
      LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: {
          providerId: 'provider-1',
          action: 'set',
          kind: 'api-key',
          storedApiKeyConfigured: true
        }
      })
    )

    await expect(
      runCli(['provider', 'set-credential', '--provider', 'provider-1', '--stdin'], {
        env: {},
        stdin: Readable.from([' super-secret \n']),
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeRpc
      })
    ).resolves.toBe(0)

    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'providers.setCredential',
        params: {
          providerId: 'provider-1',
          action: 'set',
          kind: 'api-key',
          value: ' super-secret '
        }
      })
    )
    expect(stdout.read()).toBe('Stored api-key credential for provider-1\n')
    expect(stdout.read()).not.toContain('super-secret')
    expect(stderr.read()).toBe('')
  })

  it('parses model configuration JSON from stdin before invoking the typed route', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const config = {
      maxTokens: 4096,
      contextLength: 32768,
      vision: false,
      functionCall: true,
      reasoning: true,
      type: 'chat'
    }
    const invokeRpc = vi.fn(async (invocation) =>
      LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: { config }
      })
    )

    await expect(
      runCli(['model', 'config-set', '--provider', 'provider-1', '--model', 'model-1', '--stdin'], {
        env: {},
        stdin: Readable.from([JSON.stringify(config)]),
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeRpc
      })
    ).resolves.toBe(0)

    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'models.setPublicConfig',
        params: { providerId: 'provider-1', modelId: 'model-1', config }
      })
    )
    expect(JSON.parse(stdout.read())).toEqual(config)
    expect(stderr.read()).toBe('')
  })

  it('injects bounded MCP configuration JSON under the typed route field', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const config = {
      type: 'stdio',
      command: 'npx',
      args: ['server-package'],
      environment: { SERVER_TOKEN: 'private-value' }
    }
    const invokeRpc = vi.fn(async (invocation) =>
      LocalControlRpcResponseSchema.parse({
        protocolVersion: 1,
        surfaceVersion: 1,
        id: invocation.id,
        ok: true,
        result: {
          server: {
            name: 'local-server',
            type: 'stdio',
            enabled: false,
            running: false,
            managedBy: 'user',
            editable: true,
            removable: true,
            description: '',
            commandName: 'npx',
            endpoint: null,
            argumentCount: 1,
            environmentEntryCount: 1,
            headerEntryCount: 0,
            authorizationMode: null,
            metadataTruncated: false
          }
        }
      })
    )

    await expect(
      runCli(['mcp', 'add', '--name', 'local-server', '--stdin'], {
        env: {},
        stdin: Readable.from([JSON.stringify(config)]),
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeRpc
      })
    ).resolves.toBe(0)

    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'mcp.addPublic',
        params: {
          serverName: 'local-server',
          config: {
            ...config,
            description: '',
            icon: '',
            inheritEnv: 'minimal'
          }
        }
      })
    )
    expect(stdout.read()).toBe('local-server added; disabled; runtime stopped\n')
    expect(stdout.read()).not.toContain('private-value')
    expect(stderr.read()).toBe('')
  })

  it('rejects non-object MCP stdin before transport invocation', async () => {
    const stdout = captureOutput()
    const stderr = captureOutput()
    const invokeRpc = vi.fn()

    await expect(
      runCli(['mcp', 'update', '--name', 'local-server', '--stdin', '--json'], {
        env: {},
        stdin: Readable.from(['[]']),
        stdout: stdout.stream,
        stderr: stderr.stream,
        randomId: () => 'request-1',
        loadDescriptor: async () => testDescriptor,
        invokeRpc
      })
    ).resolves.toBe(2)

    expect(LocalControlRpcResponseSchema.parse(JSON.parse(stdout.read()))).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' }
    })
    expect(stderr.read()).toBe('')
    expect(invokeRpc).not.toHaveBeenCalled()
  })
})
