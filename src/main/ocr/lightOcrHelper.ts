import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES,
  LIGHT_OCR_PROTOCOL_VERSION,
  type LightOcrBackendPreference,
  type LightOcrEngineStatus,
  type LightOcrHelperRequest,
  type LightOcrRecognitionResult,
  type LightOcrRecognitionStrategy
} from './lightOcrProtocol'

const MAX_HELPER_INPUT_BYTES = 50 * 1024 * 1024
const LIGHT_OCR_MODULE_NAME = '@arcships/light-ocr'

interface UpstreamEngine {
  readonly info: {
    coreVersion: string
    modelBundleId: string
    execution: {
      requestedProvider: string
      sessions: {
        detection: UpstreamSessionInfo
        recognition: UpstreamSessionInfo
      }
    }
  }
  recognizeEncoded(
    data: Uint8Array,
    options?: { signal?: AbortSignal; includeDiagnostics?: boolean }
  ): Promise<UpstreamRecognitionResult>
  close(): Promise<void>
}

interface UpstreamSessionInfo {
  actualProviderChain: readonly string[]
  precision: string
  qualificationId: string
}

interface UpstreamRecognitionResult {
  lines: ReadonlyArray<{
    text: string
    confidence: number
    box: readonly [
      { readonly x: number; readonly y: number },
      { readonly x: number; readonly y: number },
      { readonly x: number; readonly y: number },
      { readonly x: number; readonly y: number }
    ]
  }>
  imageWidth: number
  imageHeight: number
  modelBundleId: string
  timingUs: LightOcrRecognitionResult['timingUs']
}

type CreateEngine = (options: {
  bundlePath: string
  queueCapacity: number
  maxPendingInputBytes: number
  detection: { strategy: 'bounded' | 'tiled'; maxSide?: number }
  execution: {
    provider: LightOcrBackendPreference
    sessionFallback: 'cpu' | 'error'
    precision: 'auto'
    performanceHint: 'latency'
  }
}) => Promise<UpstreamEngine>

export interface LightOcrHelperOptions {
  bundlePath: string
  expectedBundleId: string
  tempRoot: string
  createEngine?: CreateEngine
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
}

export interface LightOcrHelperArguments {
  bundlePath: string
  expectedBundleId: string
  tempRoot: string
}

interface ConfiguredEngine {
  backend: LightOcrBackendPreference
  strategy: LightOcrRecognitionStrategy
  engine: UpstreamEngine
  status: LightOcrEngineStatus
}

export function parseLightOcrHelperArguments(argv: string[]): LightOcrHelperArguments {
  const values = new Map<string, string>()
  const allowed = new Set(['--bundle-path', '--expected-bundle-id', '--temp-root'])

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!allowed.has(argument)) {
      throw new Error(`Unknown Light OCR helper argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`)
    }
    values.set(argument, value)
    index += 1
  }

  const bundlePath = values.get('--bundle-path')
  const expectedBundleId = values.get('--expected-bundle-id')
  const tempRoot = values.get('--temp-root')
  if (!bundlePath || !expectedBundleId || !tempRoot) {
    throw new Error('Light OCR helper requires bundle path, bundle identity, and temp root')
  }
  return { bundlePath, expectedBundleId, tempRoot }
}

export async function resolvePrivateInputPath(
  tempRoot: string,
  inputPath: string
): Promise<string> {
  const [resolvedRoot, resolvedInput] = await Promise.all([realpath(tempRoot), realpath(inputPath)])
  const relative = path.relative(resolvedRoot, resolvedInput)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw helperError('invalid_input_path', 'OCR input must be a file inside the private temp root')
  }

  const inputStat = await stat(resolvedInput)
  if (!inputStat.isFile()) {
    throw helperError('invalid_input_path', 'OCR input must be a regular file')
  }
  if (inputStat.size > MAX_HELPER_INPUT_BYTES) {
    throw helperError('resource_limit_exceeded', 'OCR input exceeds the helper byte limit')
  }
  return resolvedInput
}

async function loadCreateEngine(): Promise<CreateEngine> {
  const lightOcr = (await import(LIGHT_OCR_MODULE_NAME)) as { createEngine?: CreateEngine }
  if (typeof lightOcr.createEngine !== 'function') {
    throw helperError('package_load_failed', 'Light OCR facade does not export createEngine')
  }
  return lightOcr.createEngine
}

export class LightOcrHelperServer {
  private readonly stdin: NodeJS.ReadableStream
  private readonly stdout: NodeJS.WritableStream
  private readonly stderr: NodeJS.WritableStream
  private readonly activeRecognitions = new Map<string, AbortController>()
  private configured: ConfiguredEngine | null = null
  private requestChain: Promise<void> = Promise.resolve()
  private pendingInput = Buffer.alloc(0)
  private shuttingDown = false
  private enginePoisoned = false

  constructor(private readonly options: LightOcrHelperOptions) {
    this.stdin = options.stdin ?? process.stdin
    this.stdout = options.stdout ?? process.stdout
    this.stderr = options.stderr ?? process.stderr
  }

  start(): void {
    this.send({
      type: 'hello',
      protocolVersion: LIGHT_OCR_PROTOCOL_VERSION,
      nodeVersion: process.version,
      pid: process.pid
    })

    this.stdin.on('data', (chunk: Buffer | string) => this.acceptChunk(chunk))
    this.stdin.on('end', () => void this.shutdown())
    this.stdin.on('error', () => void this.shutdown())
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    for (const controller of this.activeRecognitions.values()) controller.abort()
    await this.requestChain.catch(() => undefined)
    await this.closeEngine()
  }

  private acceptChunk(chunk: Buffer | string): void {
    if (this.shuttingDown) return
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.pendingInput = Buffer.concat([this.pendingInput, next])

    if (this.pendingInput.byteLength > LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES && !this.hasNewline()) {
      this.fatalProtocolError('Light OCR helper request exceeded the protocol line limit')
      return
    }

    let newlineIndex = this.pendingInput.indexOf(0x0a)
    while (newlineIndex >= 0) {
      const line = this.pendingInput.subarray(0, newlineIndex)
      this.pendingInput = this.pendingInput.subarray(newlineIndex + 1)
      if (line.byteLength > LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES) {
        this.fatalProtocolError('Light OCR helper request exceeded the protocol line limit')
        return
      }
      if (line.byteLength > 0) this.acceptLine(line.toString('utf8'))
      newlineIndex = this.pendingInput.indexOf(0x0a)
    }
    if (this.pendingInput.byteLength > LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES) {
      this.fatalProtocolError('Light OCR helper request exceeded the protocol line limit')
    }
  }

  private hasNewline(): boolean {
    return this.pendingInput.includes(0x0a)
  }

  private acceptLine(line: string): void {
    let request: LightOcrHelperRequest
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isHelperRequest(parsed)) {
        throw new Error('Invalid Light OCR helper request shape')
      }
      request = parsed
    } catch {
      this.fatalProtocolError('Invalid Light OCR helper request')
      return
    }

    if (request.type === 'cancel') {
      this.handleCancel(request)
      return
    }

    this.requestChain = this.requestChain
      .then(() => this.handleRequest(request))
      .catch((error) => {
        this.stderr.write(`Light OCR helper request dispatch failed: ${safeMessage(error)}\n`)
      })
  }

  private async handleRequest(request: Exclude<LightOcrHelperRequest, { type: 'cancel' }>) {
    if (this.shuttingDown && request.type !== 'shutdown') {
      this.sendError(request.id, helperError('environment_closing', 'OCR helper is shutting down'))
      return
    }

    try {
      switch (request.type) {
        case 'configure':
          this.sendResult(request.id, await this.configure(request.backend, request.strategy))
          return
        case 'recognize':
          this.sendResult(request.id, await this.recognize(request.id, request.filePath))
          return
        case 'shutdown':
          this.shuttingDown = true
          await this.closeEngine()
          this.sendResult(request.id, { closed: true })
          this.stdin.pause()
          setImmediate(() => process.exit(0))
          return
      }
    } catch (error) {
      this.sendError(request.id, error)
    }
  }

  private async configure(
    backend: LightOcrBackendPreference,
    strategy: LightOcrRecognitionStrategy
  ): Promise<LightOcrEngineStatus> {
    if (this.enginePoisoned) {
      throw helperError('engine_close_failed', 'OCR helper cannot safely create another engine')
    }
    if (this.configured?.backend === backend && this.configured.strategy === strategy) {
      return this.configured.status
    }

    await this.closeEngine(false)
    const createEngine = this.options.createEngine ?? (await loadCreateEngine())
    const engine = await createEngine({
      bundlePath: this.options.bundlePath,
      queueCapacity: 1,
      maxPendingInputBytes: MAX_HELPER_INPUT_BYTES,
      detection:
        strategy === 'bounded-960' ? { strategy: 'bounded', maxSide: 960 } : { strategy: 'tiled' },
      execution: {
        provider: backend,
        // `auto` already owns its provider fallback policy. Asking the facade for an additional
        // session fallback is an invalid option combination in light-ocr.
        sessionFallback: 'error',
        precision: 'auto',
        performanceHint: 'latency'
      }
    })

    if (engine.info.modelBundleId !== this.options.expectedBundleId) {
      try {
        await engine.close()
      } catch (error) {
        this.configured = {
          backend,
          strategy,
          engine,
          status: toEngineStatus(engine, backend, strategy)
        }
        this.enginePoisoned = true
        throw helperError(
          'engine_close_failed',
          `Unable to close an invalid OCR engine: ${safeMessage(error)}`
        )
      }
      throw helperError(
        'bundle_identity_mismatch',
        'Loaded OCR model bundle identity is unexpected'
      )
    }

    const status = toEngineStatus(engine, backend, strategy)
    this.configured = { backend, strategy, engine, status }
    return status
  }

  private async recognize(requestId: string, requestedPath: string) {
    if (!this.configured || this.enginePoisoned) {
      throw helperError('invalid_engine', 'OCR helper must be configured before recognition')
    }

    let inputPath: string
    try {
      inputPath = await resolvePrivateInputPath(this.options.tempRoot, requestedPath)
    } catch (error) {
      if (isHelperError(error)) throw error
      throw helperError('invalid_input_path', 'Unable to validate OCR input')
    }

    let input: Buffer
    try {
      input = await readFile(inputPath)
    } catch {
      throw helperError('input_read_failed', 'Unable to read OCR input')
    }

    const controller = new AbortController()
    this.activeRecognitions.set(requestId, controller)
    try {
      const result = await this.configured.engine.recognizeEncoded(input, {
        signal: controller.signal,
        includeDiagnostics: false
      })
      return toRecognitionResult(result, this.configured.status)
    } finally {
      this.activeRecognitions.delete(requestId)
    }
  }

  private handleCancel(request: Extract<LightOcrHelperRequest, { type: 'cancel' }>): void {
    const controller = this.activeRecognitions.get(request.targetId)
    controller?.abort()
    this.sendResult(request.id, { cancelled: Boolean(controller) })
  }

  private async closeEngine(suppressErrors = true): Promise<void> {
    const configured = this.configured
    this.configured = null
    if (!configured) return
    try {
      await configured.engine.close()
      this.enginePoisoned = false
    } catch (error) {
      this.configured = configured
      this.enginePoisoned = true
      if (!suppressErrors) {
        throw helperError(
          'engine_close_failed',
          `Unable to close the previous OCR engine: ${safeMessage(error)}`
        )
      }
    }
  }

  private sendResult(id: string, data: unknown): void {
    this.send({ type: 'result', id, data })
  }

  private sendError(id: string, error: unknown): void {
    const normalized = normalizeHelperError(error)
    this.send({ type: 'error', id, error: normalized })
  }

  private send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  private fatalProtocolError(message: string): void {
    this.stderr.write(`${message}\n`)
    this.shuttingDown = true
    for (const controller of this.activeRecognitions.values()) controller.abort()
    this.stdin.pause()
    void this.closeEngine().finally(() => {
      process.exit(2)
    })
  }
}

export function runLightOcrHelper(argv = process.argv.slice(2)): LightOcrHelperServer {
  const options = parseLightOcrHelperArguments(argv)
  const server = new LightOcrHelperServer(options)
  server.start()
  return server
}

function toEngineStatus(
  engine: UpstreamEngine,
  backend: LightOcrBackendPreference,
  strategy: LightOcrRecognitionStrategy
): LightOcrEngineStatus {
  const sessions = engine.info.execution.sessions
  return {
    coreVersion: engine.info.coreVersion,
    modelBundleId: engine.info.modelBundleId,
    requestedProvider: backend,
    strategy,
    detection: toStageStatus(sessions.detection),
    recognition: toStageStatus(sessions.recognition)
  }
}

function toStageStatus(session: UpstreamSessionInfo) {
  return {
    actualProviderChain: [...session.actualProviderChain],
    precision: session.precision,
    qualificationId: session.qualificationId
  }
}

function toRecognitionResult(
  result: UpstreamRecognitionResult,
  engine: LightOcrEngineStatus
): LightOcrRecognitionResult {
  return {
    lines: result.lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      box: line.box.map((point) => ({
        x: point.x,
        y: point.y
      })) as LightOcrRecognitionResult['lines'][number]['box']
    })),
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    modelBundleId: result.modelBundleId,
    timingUs: { ...result.timingUs },
    engine
  }
}

function isHelperRequest(value: unknown): value is LightOcrHelperRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (typeof request.id !== 'string' || request.id.length === 0) return false
  switch (request.type) {
    case 'configure':
      return (
        (request.backend === 'auto' || request.backend === 'cpu') &&
        (request.strategy === 'bounded-960' || request.strategy === 'tiled-v1')
      )
    case 'recognize':
      return typeof request.filePath === 'string' && request.filePath.length > 0
    case 'cancel':
      return typeof request.targetId === 'string' && request.targetId.length > 0
    case 'shutdown':
      return true
    default:
      return false
  }
}

function helperError(
  code: string,
  message: string,
  detail?: string
): Error & { code: string; detail?: string } {
  return Object.assign(new Error(message), { code, detail })
}

function isHelperError(error: unknown): error is Error & { code: string; detail?: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
}

function normalizeHelperError(error: unknown): { code: string; message: string; detail?: string } {
  if (isHelperError(error)) {
    return {
      code: error.code,
      message: safeMessage(error),
      ...(error.detail ? { detail: error.detail.slice(0, 2_048) } : {})
    }
  }
  return { code: 'internal_error', message: safeMessage(error) }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2_048)
}
