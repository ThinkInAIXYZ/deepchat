import { randomUUID } from 'node:crypto'
import { JsonValueSchema, type JsonValue } from '@shared/contracts/json'
import { getDeepchatEventContract, RunStreamEventNameSchema } from '@shared/contracts/events'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  createLocalControlFailure,
  type LocalControlDescriptor,
  type LocalControlRpcResponse
} from '@shared/contracts/localControl'
import { artifactsDescribeRoute } from '@shared/contracts/routes/artifacts.routes'
import { MediaGenerationEventSchema } from '@shared/contracts/routes/media.routes'
import { ModelInvokeEventSchema } from '@shared/contracts/routes/models.routes'
import { PUBLIC_MCP_CONFIG_MAX_BYTES } from '@shared/contracts/routes/mcp.routes'
import { PROVIDER_CREDENTIAL_MAX_BYTES } from '@shared/contracts/routes/providers.routes'
import {
  RUN_PROMPT_MAX_CHARACTERS,
  sessionsRunDetachedRoute
} from '@shared/contracts/routes/runs.routes'
import { parseCliArguments, formatCliHelp, inferCliOutputMode, type CliOutputMode } from './args'
import {
  loadLocalControlDescriptor,
  selectLocalControlToken,
  type CliDiscoveryOptions
} from './discovery'
import {
  CLI_EXIT_CODES,
  CliClientError,
  CliUsageError,
  exitCodeForRemoteError,
  type CliExitCode
} from './errors'
import { formatHumanResult, serializeMachineResponse } from './format'
import {
  invokeLocalControlRpc,
  invokeLocalControlStream,
  invokeLocalControlUpload,
  type CliRpcInvocation,
  type CliStreamEventHandler,
  type CliUploadInvocation
} from './transport'
import { downloadArtifact } from './artifacts'
import { readBoundedUtf8Stdin } from './stdin'

const SIGNAL_GRACE_MS = 1_000

type WritableOutput = Pick<NodeJS.WriteStream, 'write'>
type SignalHost = Pick<NodeJS.Process, 'on' | 'off'>

export type CliRunDependencies = Readonly<{
  env?: NodeJS.ProcessEnv
  discovery?: Omit<CliDiscoveryOptions, 'env'>
  stdout?: WritableOutput
  stderr?: WritableOutput
  stdin?: NodeJS.ReadableStream
  signalHost?: SignalHost
  randomId?: () => string
  loadDescriptor?: (options: CliDiscoveryOptions) => Promise<LocalControlDescriptor>
  invokeRpc?: (invocation: CliRpcInvocation) => Promise<LocalControlRpcResponse>
  invokeStream?: (
    invocation: CliRpcInvocation,
    onEvent: CliStreamEventHandler
  ) => Promise<LocalControlRpcResponse>
  invokeUpload?: (invocation: CliUploadInvocation) => Promise<LocalControlRpcResponse>
  forceExit?: (code: number) => void
}>

function writeText(output: WritableOutput, value: string): void {
  output.write(value.endsWith('\n') ? value : `${value}\n`)
}

function sanitizeTerminalText(value: string): string {
  const output: string[] = []
  let start = 0
  let offset = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const isUnsafeControl =
      codePoint === 0x0d ||
      (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    const isBidiControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    if (isUnsafeControl || isBidiControl) {
      if (offset > start) output.push(value.slice(start, offset))
      start = offset + character.length
    }
    offset += character.length
  }
  if (start === 0) return value
  if (start < value.length) output.push(value.slice(start))
  return output.join('')
}

function writeHumanText(output: WritableOutput, value: string): void {
  writeText(output, sanitizeTerminalText(value))
}

function runEventPayloadMatchesTarget(
  event: Parameters<CliStreamEventHandler>[0],
  data: JsonValue,
  expectedRunId: string | undefined
): boolean {
  if (!event.event.startsWith('runs.')) return true
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (event.event === 'runs.snapshot') {
    const run = data.run
    if (!run || typeof run !== 'object' || Array.isArray(run)) return false
    return data.cursor === event.cursor && run.runId === expectedRunId
  }
  return data.runId === expectedRunId
}

function parseStdinJsonObject(input: string, label: string): Record<string, JsonValue> {
  let candidate: unknown
  try {
    candidate = JSON.parse(input) as unknown
  } catch {
    throw new CliClientError(
      'invalid_request',
      `${label} stdin must be valid JSON`,
      CLI_EXIT_CODES.usage
    )
  }
  const parsed = JsonValueSchema.safeParse(candidate)
  if (
    !parsed.success ||
    !parsed.data ||
    typeof parsed.data !== 'object' ||
    Array.isArray(parsed.data)
  ) {
    throw new CliClientError(
      'invalid_request',
      `${label} stdin must be a JSON object`,
      CLI_EXIT_CODES.usage
    )
  }
  return parsed.data
}

function writeClientError(
  error: CliClientError,
  outputMode: CliOutputMode,
  requestId: string,
  stdout: WritableOutput,
  stderr: WritableOutput
): void {
  if (outputMode === 'text') {
    writeHumanText(stderr, `${error.code}: ${error.message}`)
    return
  }
  writeText(
    stdout,
    serializeMachineResponse(
      createLocalControlFailure(requestId, {
        code: error.code,
        message: error.message,
        retriable: error.retriable
      })
    )
  )
}

function parseStreamEventData(
  method: string,
  event: Parameters<CliStreamEventHandler>[0],
  expectedRunId?: string
): JsonValue {
  const runEventName =
    method === 'events.subscribe' ? RunStreamEventNameSchema.safeParse(event.event) : null
  const parsed =
    method === 'events.subscribe'
      ? event.runId === expectedRunId && typeof event.cursor === 'string' && runEventName?.success
        ? getDeepchatEventContract(runEventName.data).payload.safeParse(event.data)
        : null
      : event.event !== method
        ? null
        : method === 'models.invoke'
          ? ModelInvokeEventSchema.safeParse(event.data)
          : method === 'images.generate' ||
              method === 'videos.generate' ||
              method === 'speech.generate'
            ? MediaGenerationEventSchema.safeParse(event.data)
            : null
  if (!parsed?.success) {
    throw new CliClientError(
      'internal_error',
      'DeepChat emitted an invalid stream event',
      CLI_EXIT_CODES.internal
    )
  }
  const data = JsonValueSchema.safeParse(parsed.data)
  if (!data.success) {
    throw new CliClientError(
      'internal_error',
      'DeepChat emitted a non-JSON stream event',
      CLI_EXIT_CODES.internal
    )
  }
  if (
    method === 'events.subscribe' &&
    !runEventPayloadMatchesTarget(event, data.data, expectedRunId)
  ) {
    throw new CliClientError(
      'internal_error',
      'DeepChat emitted an event for another run',
      CLI_EXIT_CODES.internal
    )
  }
  return data.data
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliRunDependencies = {}
): Promise<CliExitCode> {
  const env = dependencies.env ?? process.env
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const stdin = dependencies.stdin ?? process.stdin
  const signalHost = dependencies.signalHost ?? process
  const requestId = (dependencies.randomId ?? randomUUID)()

  let parsed
  try {
    parsed = parseCliArguments(argv, env)
  } catch (error) {
    const message = error instanceof CliUsageError ? error.message : 'Invalid CLI arguments'
    const outputMode = inferCliOutputMode(argv, env)
    if (outputMode === 'text') {
      writeHumanText(stderr, message)
      writeHumanText(stderr, 'Run: deepchat help')
    } else {
      writeClientError(
        new CliClientError('invalid_request', message, CLI_EXIT_CODES.usage),
        outputMode,
        requestId,
        stdout,
        stderr
      )
    }
    return CLI_EXIT_CODES.usage
  }

  if (parsed.helpRequested) {
    writeText(stdout, formatCliHelp(parsed))
    return CLI_EXIT_CODES.success
  }
  if (!parsed.contract) {
    writeText(stderr, 'CLI command is not implemented')
    return CLI_EXIT_CODES.internal
  }

  const controller = new AbortController()
  let forcedExitTimer: NodeJS.Timeout | undefined
  let timeout: NodeJS.Timeout | undefined
  let signalCount = 0
  const forceExit = dependencies.forceExit ?? ((code: number) => process.exit(code))
  const abortWith = (error: CliClientError) => {
    if (!controller.signal.aborted) controller.abort(error)
  }
  const onSignal = () => {
    signalCount += 1
    if (signalCount > 1) {
      forceExit(CLI_EXIT_CODES.cancelled)
      return
    }
    abortWith(
      new CliClientError('cancelled', 'CLI request was interrupted', CLI_EXIT_CODES.cancelled)
    )
    forcedExitTimer = setTimeout(() => forceExit(CLI_EXIT_CODES.cancelled), SIGNAL_GRACE_MS)
  }

  signalHost.on('SIGINT', onSignal)
  signalHost.on('SIGTERM', onSignal)
  timeout = setTimeout(() => {
    abortWith(
      new CliClientError('timeout', 'CLI request timed out', CLI_EXIT_CODES.cancelled, true)
    )
  }, parsed.timeoutMs)

  try {
    let params = parsed.params
    if (parsed.readStdin) {
      const input = await readBoundedUtf8Stdin(
        stdin,
        controller.signal,
        parsed.contract.name === 'providers.setCredential'
          ? PROVIDER_CREDENTIAL_MAX_BYTES
          : parsed.contract.name === sessionsRunDetachedRoute.name
            ? RUN_PROMPT_MAX_CHARACTERS * 4
            : parsed.contract.name === 'mcp.addPublic' ||
                parsed.contract.name === 'mcp.updatePublic'
              ? PUBLIC_MCP_CONFIG_MAX_BYTES
              : undefined
      )
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new CliClientError(
          'internal_error',
          'CLI command has invalid input parameters',
          CLI_EXIT_CODES.internal
        )
      }
      switch (parsed.contract.name) {
        case 'models.invoke': {
          const messages = Array.isArray(params.messages) ? params.messages : []
          params = { ...params, messages: [...messages, { role: 'user', content: input }] }
          break
        }
        case 'images.generate':
        case 'videos.generate':
          params = { ...params, prompt: input }
          break
        case 'speech.generate':
          params = { ...params, text: input }
          break
        case 'sessions.runDetached':
          params = { ...params, prompt: input }
          break
        case 'providers.setCredential':
          params = { ...params, value: input.replace(/(?:\r\n|\n)$/, '') }
          break
        case 'models.setPublicConfig': {
          params = { ...params, config: parseStdinJsonObject(input, 'Model configuration') }
          break
        }
        case 'mcp.addPublic': {
          params = { ...params, config: parseStdinJsonObject(input, 'MCP configuration') }
          break
        }
        case 'mcp.updatePublic': {
          params = { ...params, updates: parseStdinJsonObject(input, 'MCP update') }
          break
        }
        case 'tool.call':
        case 'tool.batch': {
          params = parseStdinJsonObject(input, 'Programmatic Tool request')
          break
        }
        default:
          throw new CliClientError(
            'internal_error',
            'CLI command does not accept standard input',
            CLI_EXIT_CODES.internal
          )
      }
    }
    const validatedInput = parsed.contract.input.safeParse(params)
    if (!validatedInput.success) {
      throw new CliClientError(
        'invalid_request',
        'CLI input does not match the command contract',
        CLI_EXIT_CODES.usage
      )
    }
    const descriptor = await (dependencies.loadDescriptor ?? loadLocalControlDescriptor)({
      ...dependencies.discovery,
      env
    })
    if (controller.signal.aborted) throw controller.signal.reason
    const token = selectLocalControlToken(descriptor, env)
    if (
      parsed.operation === 'download' &&
      Object.prototype.hasOwnProperty.call(env, LOCAL_CONTROL_AGENT_TOKEN_ENV)
    ) {
      throw new CliClientError(
        'permission_denied',
        'Agent callers cannot download artifact bytes or use --out',
        CLI_EXIT_CODES.authorization
      )
    }
    if (
      parsed.operation === 'upload' &&
      Object.prototype.hasOwnProperty.call(env, LOCAL_CONTROL_AGENT_TOKEN_ENV)
    ) {
      throw new CliClientError(
        'permission_denied',
        'Agent callers cannot upload local file bytes or use --file',
        CLI_EXIT_CODES.authorization
      )
    }
    const invocationContract =
      parsed.operation === 'download' ? artifactsDescribeRoute : parsed.contract
    const invocation: CliRpcInvocation = {
      descriptor,
      token,
      id: requestId,
      method: invocationContract.name,
      params: validatedInput.data,
      signal: controller.signal
    }
    let streamedText = false
    let streamedTextEndsWithNewline = false
    const contractName = parsed.contract.name
    const expectedRunId =
      contractName === 'events.subscribe' &&
      validatedInput.data &&
      typeof validatedInput.data === 'object' &&
      'runId' in validatedInput.data &&
      typeof validatedInput.data.runId === 'string'
        ? validatedInput.data.runId
        : undefined
    const onStreamEvent: CliStreamEventHandler = async (event) => {
      const canonicalData = parseStreamEventData(contractName, event, expectedRunId)
      if (parsed.outputMode === 'jsonl') {
        writeText(stdout, JSON.stringify({ ...event, data: canonicalData }))
        return
      }
      if (parsed.outputMode !== 'text' || contractName !== 'models.invoke') return
      const parsedEvent = ModelInvokeEventSchema.parse(canonicalData)
      if (parsedEvent.type === 'text_delta' && parsedEvent.text) {
        const safeText = sanitizeTerminalText(parsedEvent.text)
        if (!safeText) return
        stdout.write(safeText)
        streamedText = true
        streamedTextEndsWithNewline = safeText.endsWith('\n')
      }
    }
    let response: LocalControlRpcResponse
    if (parsed.operation === 'stream') {
      response = await (dependencies.invokeStream ?? invokeLocalControlStream)(
        invocation,
        onStreamEvent
      )
    } else if (parsed.operation === 'upload') {
      if (!parsed.inputPath || !parsed.uploadMaxBytes) {
        throw new CliClientError(
          'internal_error',
          'Upload command has no validated input source',
          CLI_EXIT_CODES.internal
        )
      }
      response = await (dependencies.invokeUpload ?? invokeLocalControlUpload)({
        ...invocation,
        filePath: parsed.inputPath,
        maxBytes: parsed.uploadMaxBytes
      })
    } else {
      response = await (dependencies.invokeRpc ?? invokeLocalControlRpc)(invocation)
    }

    if (!response.ok) {
      if (streamedText && !streamedTextEndsWithNewline) stdout.write('\n')
      if (parsed.outputMode === 'text') {
        writeHumanText(stderr, `${response.error.code}: ${response.error.message}`)
      } else {
        writeText(stdout, serializeMachineResponse(response))
      }
      return exitCodeForRemoteError(response.error)
    }

    const result = parsed.contract.output.safeParse(response.result)
    if (!result.success) {
      throw new CliClientError(
        'internal_error',
        'DeepChat result did not match the command contract',
        CLI_EXIT_CODES.internal
      )
    }
    if (parsed.operation === 'download') {
      if (!parsed.outputPath || !('artifact' in result.data)) {
        throw new CliClientError(
          'internal_error',
          'Artifact download command has no validated output target',
          CLI_EXIT_CODES.internal
        )
      }
      await downloadArtifact({
        descriptor,
        token,
        metadata: result.data.artifact,
        outputPath: parsed.outputPath,
        overwrite: parsed.overwrite,
        signal: controller.signal
      })
    }
    if (
      parsed.operation === 'stream' &&
      parsed.contract.name === 'models.invoke' &&
      parsed.outputMode === 'text'
    ) {
      if (!streamedText || !streamedTextEndsWithNewline) stdout.write('\n')
    } else if (parsed.outputMode === 'text') {
      writeHumanText(
        stdout,
        formatHumanResult(parsed.contract, response.result, { outputPath: parsed.outputPath })
      )
    } else {
      writeText(stdout, serializeMachineResponse(response))
    }
    return CLI_EXIT_CODES.success
  } catch (error) {
    const clientError =
      error instanceof CliClientError
        ? error
        : new CliClientError(
            'internal_error',
            error instanceof Error ? error.message : 'Unexpected CLI failure',
            CLI_EXIT_CODES.internal
          )
    writeClientError(clientError, parsed.outputMode, requestId, stdout, stderr)
    return clientError.exitCode
  } finally {
    if (timeout) clearTimeout(timeout)
    if (forcedExitTimer) clearTimeout(forcedExitTimer)
    signalHost.off('SIGINT', onSignal)
    signalHost.off('SIGTERM', onSignal)
  }
}
