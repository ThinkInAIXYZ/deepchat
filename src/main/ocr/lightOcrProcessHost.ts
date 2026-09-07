import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import runtimeVersions from '../../../resources/runtime-versions.json'
import {
  materializeLightOcrNativePayload,
  type LightOcrNativePayloadEncoding,
  type LightOcrNativeRuntimeOverride
} from './lightOcrNativePayload'
import {
  LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES,
  LIGHT_OCR_PROTOCOL_VERSION,
  isLightOcrDocumentOptions,
  isLightOcrDocumentPage,
  isLightOcrEngineStatus,
  isLightOcrHelperMessage,
  isLightOcrRecognitionResult,
  type LightOcrBackendPreference,
  type LightOcrDocumentOptions,
  type LightOcrDocumentPage,
  type LightOcrEngineStatus,
  type LightOcrHelperMessage,
  type LightOcrHelperRequest,
  type LightOcrRecognitionResult,
  type LightOcrRecognitionStrategy
} from './lightOcrProtocol'

const DEFAULT_INITIALIZATION_TIMEOUT_MS = 60_000
const DEFAULT_RECOGNITION_TIMEOUT_MS = 120_000
const DEFAULT_DOCUMENT_IDLE_TIMEOUT_MS = 120_000
const DEFAULT_DOCUMENT_TOTAL_TIMEOUT_MS = 10 * 60_000
const DEFAULT_DOCUMENT_STOP_TIMEOUT_MS = DEFAULT_DOCUMENT_IDLE_TIMEOUT_MS
const DEFAULT_IDLE_TIMEOUT_MS = 120_000
const DEFAULT_CANCEL_GRACE_MS = 1_000
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000
const DEFAULT_MAX_INPUT_BYTES = LIGHT_OCR_HELPER_MAX_INPUT_BYTES
const DEFAULT_MAX_PENDING_INPUT_BYTES = 120 * 1024 * 1024
const DEFAULT_MAX_PENDING_REQUESTS = 8
const MAX_STDERR_BYTES = 16 * 1024
const DOCUMENT_SNAPSHOT_CHUNK_BYTES = 1024 * 1024
const INHERITED_HELPER_ENVIRONMENT_KEYS = [
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NUMBER_OF_PROCESSORS',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'WINDIR'
] as const
const FATAL_HELPER_ERROR_CODES = new Set([
  'bundle_io_failed',
  'bundle_identity_mismatch',
  'engine_close_failed',
  'document_engine_close_failed',
  'invalid_model_bundle',
  'invalid_result',
  'model_integrity_failed',
  'package_load_failed',
  'runtime_initialization_failed',
  'unsupported_model',
  'unsupported_platform'
])

type SpawnProcess = typeof spawn

export function createLightOcrHelperEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
  testEnvironment: NodeJS.ProcessEnv = {},
  nativeRuntimeOverride?: LightOcrNativeRuntimeOverride
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of INHERITED_HELPER_ENVIRONMENT_KEYS) {
    if (typeof inherited[key] === 'string') environment[key] = inherited[key]
  }
  for (const [key, value] of Object.entries(testEnvironment)) {
    if (key.startsWith('FAKE_OCR_') && typeof value === 'string') environment[key] = value
  }

  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DYLD_') || key.startsWith('LD_')) delete environment[key]
  }
  environment.DEEPCHAT_LIGHT_OCR_HELPER = '1'
  if (nativeRuntimeOverride) {
    environment.LIGHT_OCR_NODE_BINARY = nativeRuntimeOverride.nodeBinaryPath
    environment.LIGHT_OCR_RUNTIME_DESCRIPTOR = nativeRuntimeOverride.runtimeDescriptorPath
    environment.LIGHT_OCR_PDFIUM_MODULE = nativeRuntimeOverride.pdfiumModulePath
  }
  return environment
}

export interface LightOcrProcessHostOptions {
  nodeExecutable: string
  helperEntryPath: string
  bundlePath: string
  expectedBundleId: string
  nativePackageDir?: string
  nativePayloadEncoding?: LightOcrNativePayloadEncoding
  tempBaseDir: string
  expectedNodeVersion?: string
  initializationTimeoutMs?: number
  recognitionTimeoutMs?: number
  documentIdleTimeoutMs?: number
  documentTotalTimeoutMs?: number
  documentStopTimeoutMs?: number
  idleTimeoutMs?: number
  cancelGraceMs?: number
  shutdownGraceMs?: number
  maxInputBytes?: number
  maxPendingInputBytes?: number
  maxPendingRequests?: number
  testEnvironment?: NodeJS.ProcessEnv
  spawnProcess?: SpawnProcess
}

export interface LightOcrProcessHostStatus {
  state: 'idle' | 'starting' | 'ready' | 'busy' | 'stopping' | 'closed'
  pid: number | null
  nodeVersion: string | null
  queuedRequests: number
  pendingInputBytes: number
  engine: LightOcrEngineStatus | null
  stderrBytesCaptured: number
}

export interface LightOcrRecognizeInput {
  encoded: Uint8Array
  backend: LightOcrBackendPreference
  strategy: LightOcrRecognitionStrategy
  signal?: AbortSignal
}

export type LightOcrPrepareInput = Omit<LightOcrRecognizeInput, 'encoded'>

export type LightOcrDocumentPageAction = 'continue' | 'output_limit_reached'

export interface LightOcrDocumentSourceSnapshot {
  readonly filePath: string
  readonly byteLength: number
  readonly sourceSha256: string
  release(): Promise<void>
}

export interface LightOcrCreateDocumentSourceSnapshotInput {
  readonly filePath: string
  readonly maxFileBytes: number
  readonly signal?: AbortSignal
}

export interface LightOcrRecognizeDocumentInput extends LightOcrPrepareInput {
  snapshot: LightOcrDocumentSourceSnapshot
  options: LightOcrDocumentOptions
  onPage: (page: LightOcrDocumentPage) => LightOcrDocumentPageAction
}

export type LightOcrDocumentArtifactTermination =
  | 'request_complete'
  | 'stopped_by_output_limit'
  | 'resource_limited'

export interface LightOcrDocumentRecognitionOutcome {
  artifactTermination: LightOcrDocumentArtifactTermination
  emittedPages: number
  generationOutputLimitReached: boolean
  engine: LightOcrEngineStatus
  resourceLimit?: {
    code: 'resource_limit_exceeded'
    message: string
    detail?: string
  }
}

type QueueResult =
  | LightOcrEngineStatus
  | LightOcrRecognitionResult
  | LightOcrDocumentRecognitionOutcome

interface QueueItem {
  operation: 'configure' | 'recognize' | 'recognize_document'
  encoded: Buffer | null
  inputByteLength: number
  backend: LightOcrBackendPreference
  strategy: LightOcrRecognitionStrategy
  signal?: AbortSignal
  cancelled: boolean
  settled: boolean
  resolve: (value: QueueResult) => void
  reject: (error: unknown) => void
  abortListener?: () => void
  documentOptions?: LightOcrDocumentOptions
  documentSnapshot?: LightOcrDocumentSourceSnapshot
  onDocumentPage?: (page: LightOcrDocumentPage) => LightOcrDocumentPageAction
}

interface PendingResponse {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timeout: NodeJS.Timeout
}

interface HandshakeWaiter {
  resolve: () => void
  reject: (error: unknown) => void
  timeout: NodeJS.Timeout
}

interface PendingDocumentResponse {
  request: Extract<LightOcrHelperRequest, { type: 'recognize_document' }>
  engine: LightOcrEngineStatus
  onPage: (page: LightOcrDocumentPage) => LightOcrDocumentPageAction
  resolve: (value: LightOcrDocumentRecognitionOutcome) => void
  reject: (error: unknown) => void
  idleTimeout: NodeJS.Timeout
  totalTimeout: NodeJS.Timeout
  expectedNextPageIndex: number
  receivedPages: number
  receivedPixels: number
  generationOutputLimitReached: boolean
  stopRequestId: string | null
  stopAcknowledged: boolean | null
  completion: { emittedPages: number } | null
}

interface PendingDocumentStop {
  documentRequestId: string
  timeout: NodeJS.Timeout
}

export class LightOcrProcessHostError extends Error {
  constructor(
    readonly code:
      | 'cancelled'
      | 'closed'
      | 'empty_input'
      | 'helper_error'
      | 'input_too_large'
      | 'invalid_input'
      | 'invalid_protocol'
      | 'page_handler_failed'
      | 'queue_full'
      | 'runtime_missing'
      | 'snapshot_io_failed'
      | 'timeout'
      | 'unexpected_exit',
    message: string,
    options?: ErrorOptions & { helperCode?: string; detail?: string }
  ) {
    super(message, options)
    this.name = 'LightOcrProcessHostError'
    this.helperCode = options?.helperCode
    this.detail = options?.detail
  }

  readonly helperCode?: string
  readonly detail?: string
}

export class LightOcrProcessHost {
  private readonly expectedNodeVersion: string
  private readonly initializationTimeoutMs: number
  private readonly recognitionTimeoutMs: number
  private readonly documentIdleTimeoutMs: number
  private readonly documentTotalTimeoutMs: number
  private readonly documentStopTimeoutMs: number
  private readonly idleTimeoutMs: number
  private readonly cancelGraceMs: number
  private readonly shutdownGraceMs: number
  private readonly maxInputBytes: number
  private readonly maxPendingInputBytes: number
  private readonly maxPendingRequests: number
  private readonly spawnProcess: SpawnProcess
  private readonly queue: QueueItem[] = []
  private readonly pendingResponses = new Map<string, PendingResponse>()
  private readonly pendingDocumentResponses = new Map<string, PendingDocumentResponse>()
  private readonly pendingDocumentStops = new Map<string, PendingDocumentStop>()
  private readonly documentSnapshotCreations = new Set<Promise<LightOcrDocumentSourceSnapshot>>()
  private readonly documentSnapshots = new Map<
    string,
    { readonly byteLength: number; readonly sourceSha256: string }
  >()
  private readonly ignoredResponseIds = new Set<string>()
  private readonly terminatingChildren = new Set<Promise<void>>()
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private handshake: HandshakeWaiter | null = null
  private activeItem: QueueItem | null = null
  private pumpPromise: Promise<void> | null = null
  private tempRoot: string | null = null
  private tempRootPromise: Promise<string> | null = null
  private nativeRuntimePromise: Promise<LightOcrNativeRuntimeOverride> | null = null
  private configuredKey: string | null = null
  private engineStatus: LightOcrEngineStatus | null = null
  private nodeVersion: string | null = null
  private stdoutSegments: Buffer[] = []
  private stdoutBufferedBytes = 0
  private stderrTail = Buffer.alloc(0)
  private stderrBytesCaptured = 0
  private pendingInputBytes = 0
  private activeWireRequestId: string | null = null
  private activeWireRequestType: LightOcrHelperRequest['type'] | null = null
  private cancelFallbackTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private closed = false

  constructor(private readonly options: LightOcrProcessHostOptions) {
    this.expectedNodeVersion = options.expectedNodeVersion ?? runtimeVersions.node
    this.initializationTimeoutMs =
      options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT_MS
    this.recognitionTimeoutMs = options.recognitionTimeoutMs ?? DEFAULT_RECOGNITION_TIMEOUT_MS
    this.documentIdleTimeoutMs = options.documentIdleTimeoutMs ?? DEFAULT_DOCUMENT_IDLE_TIMEOUT_MS
    this.documentTotalTimeoutMs =
      options.documentTotalTimeoutMs ?? DEFAULT_DOCUMENT_TOTAL_TIMEOUT_MS
    this.documentStopTimeoutMs =
      options.documentStopTimeoutMs ??
      options.documentIdleTimeoutMs ??
      DEFAULT_DOCUMENT_STOP_TIMEOUT_MS
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES
    this.maxPendingInputBytes = options.maxPendingInputBytes ?? DEFAULT_MAX_PENDING_INPUT_BYTES
    this.maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  async prepare(input: LightOcrPrepareInput): Promise<LightOcrEngineStatus> {
    const result = await this.enqueue('configure', null, input)
    if (!isLightOcrEngineStatus(result)) {
      throw this.failProtocol('OCR process queue returned an invalid engine status')
    }
    return structuredClone(result)
  }

  recognize(input: LightOcrRecognizeInput): Promise<LightOcrRecognitionResult> {
    if (input.encoded.byteLength > this.maxInputBytes) {
      return Promise.reject(
        new LightOcrProcessHostError(
          'input_too_large',
          'OCR input exceeds the per-image byte limit'
        )
      )
    }
    return this.enqueue('recognize', input.encoded, input).then((result) => {
      if (!isLightOcrRecognitionResult(result)) {
        throw this.failProtocol('OCR process queue returned an invalid recognition result')
      }
      return result
    })
  }

  createDocumentSourceSnapshot(
    input: LightOcrCreateDocumentSourceSnapshotInput
  ): Promise<LightOcrDocumentSourceSnapshot> {
    const creation = this.createDocumentSourceSnapshotInternal(input)
    this.documentSnapshotCreations.add(creation)
    creation.then(
      () => this.documentSnapshotCreations.delete(creation),
      () => this.documentSnapshotCreations.delete(creation)
    )
    return creation
  }

  private async createDocumentSourceSnapshotInternal(
    input: LightOcrCreateDocumentSourceSnapshotInput
  ): Promise<LightOcrDocumentSourceSnapshot> {
    if (this.closed) {
      throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
    }
    if (input.signal?.aborted) throw cancelledError()
    if (
      !Number.isSafeInteger(input.maxFileBytes) ||
      input.maxFileBytes <= 0 ||
      input.maxFileBytes > this.maxInputBytes
    ) {
      throw new LightOcrProcessHostError(
        'invalid_protocol',
        'OCR document snapshot has an invalid byte limit'
      )
    }

    const tempRoot = await this.ensureTempRoot()
    const snapshotPath = path.join(tempRoot, `${randomUUID()}.pdf`)
    const metadata = await this.copyDocumentSourceSnapshot(
      input.filePath,
      snapshotPath,
      input.maxFileBytes,
      input.signal
    )
    if (this.closed) {
      await rm(snapshotPath, { force: true })
      throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
    }
    this.documentSnapshots.set(snapshotPath, metadata)
    return Object.freeze({
      filePath: snapshotPath,
      ...metadata,
      release: async () => {
        await this.releaseDocumentSourceSnapshot(snapshotPath, metadata)
      }
    })
  }

  recognizeDocument(
    input: LightOcrRecognizeDocumentInput
  ): Promise<LightOcrDocumentRecognitionOutcome> {
    const ownedSnapshot = this.documentSnapshots.get(input.snapshot.filePath)
    if (
      !isLightOcrDocumentOptions(input.options) ||
      input.options.maxFileBytes > this.maxInputBytes ||
      !ownedSnapshot ||
      ownedSnapshot.byteLength !== input.snapshot.byteLength ||
      ownedSnapshot.sourceSha256 !== input.snapshot.sourceSha256 ||
      typeof input.onPage !== 'function'
    ) {
      return Promise.reject(
        new LightOcrProcessHostError(
          'invalid_protocol',
          'OCR document request has invalid resource options'
        )
      )
    }
    if (
      input.snapshot.byteLength > this.maxInputBytes ||
      input.snapshot.byteLength > input.options.maxFileBytes
    ) {
      return Promise.reject(
        new LightOcrProcessHostError(
          'input_too_large',
          'OCR document exceeds the effective file byte limit'
        )
      )
    }

    return this.enqueue('recognize_document', null, input, {
      options: structuredClone(input.options),
      snapshot: input.snapshot,
      onPage: input.onPage
    }).then((result) => {
      if (!isDocumentRecognitionOutcome(result)) {
        throw this.failProtocol('OCR process queue returned an invalid document outcome')
      }
      return result
    })
  }

  private enqueue(
    operation: QueueItem['operation'],
    encoded: Uint8Array | null,
    input: LightOcrPrepareInput,
    document?: {
      options: LightOcrDocumentOptions
      snapshot: LightOcrDocumentSourceSnapshot
      onPage: (page: LightOcrDocumentPage) => LightOcrDocumentPageAction
    }
  ): Promise<QueueResult> {
    if (this.closed) {
      return Promise.reject(new LightOcrProcessHostError('closed', 'OCR process host is closed'))
    }
    if (input.signal?.aborted) {
      return Promise.reject(cancelledError())
    }
    const inputBytes = encoded?.byteLength ?? document?.snapshot.byteLength ?? 0
    if (
      this.queue.length + (this.activeItem ? 1 : 0) >= this.maxPendingRequests ||
      this.pendingInputBytes + inputBytes > this.maxPendingInputBytes
    ) {
      return Promise.reject(new LightOcrProcessHostError('queue_full', 'OCR process queue is full'))
    }

    this.clearIdleTimer()
    const encodedSnapshot = encoded ? Buffer.from(encoded) : null
    this.pendingInputBytes += inputBytes

    return new Promise<QueueResult>((resolve, reject) => {
      const item: QueueItem = {
        operation,
        encoded: encodedSnapshot,
        inputByteLength: inputBytes,
        backend: input.backend,
        strategy: input.strategy,
        signal: input.signal,
        cancelled: false,
        settled: false,
        resolve,
        reject,
        documentOptions: document?.options,
        documentSnapshot: document?.snapshot,
        onDocumentPage: document?.onPage
      }
      if (input.signal) {
        item.abortListener = () => this.cancelQueueItem(item)
        input.signal.addEventListener('abort', item.abortListener, { once: true })
      }
      this.queue.push(item)
      if (input.signal?.aborted) this.cancelQueueItem(item)
      else this.startPump()
    })
  }

  getStatus(): LightOcrProcessHostStatus {
    let state: LightOcrProcessHostStatus['state']
    if (this.closed) state = 'closed'
    else if (this.activeItem) state = 'busy'
    else if (this.starting) state = 'starting'
    else if (this.stopping) state = 'stopping'
    else if (this.child) state = 'ready'
    else state = 'idle'

    return {
      state,
      pid: this.child?.pid ?? null,
      nodeVersion: this.nodeVersion,
      queuedRequests: this.queue.length,
      pendingInputBytes: this.pendingInputBytes,
      engine: this.engineStatus,
      stderrBytesCaptured: this.stderrBytesCaptured
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearIdleTimer()

    for (const item of this.queue.splice(0)) {
      this.pendingInputBytes -= item.inputByteLength
      this.settleQueueItem(
        item,
        'reject',
        new LightOcrProcessHostError('closed', 'OCR process host is closed')
      )
    }
    if (this.activeItem) {
      this.activeItem.cancelled = true
      this.disposeProcess(
        new LightOcrProcessHostError('closed', 'OCR process host is closed'),
        true
      )
    }
    await this.pumpPromise?.catch(() => undefined)
    await this.stopProcessGracefully()
    await Promise.all(this.terminatingChildren)
    await Promise.allSettled(this.documentSnapshotCreations)

    if (this.tempRoot) {
      await rm(this.tempRoot, { recursive: true, force: true })
      this.tempRoot = null
      this.nativeRuntimePromise = null
    }
    this.documentSnapshots.clear()
  }

  private startPump(): void {
    if (this.pumpPromise) return
    this.pumpPromise = this.pumpQueue().finally(() => {
      this.pumpPromise = null
      if (this.queue.length > 0 && !this.closed) this.startPump()
      else if (!this.closed) this.scheduleIdleStop()
    })
  }

  private async pumpQueue(): Promise<void> {
    while (!this.closed && this.queue.length > 0) {
      const item = this.queue.shift()!
      this.activeItem = item
      try {
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        let result: QueueResult
        switch (item.operation) {
          case 'configure':
            result = await this.configureQueueItem(item)
            break
          case 'recognize':
            result = await this.recognizeQueueItem(item)
            break
          case 'recognize_document':
            result = await this.recognizeDocumentQueueItem(item)
            break
        }
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        this.settleQueueItem(item, 'resolve', result)
      } catch (error) {
        this.settleQueueItem(item, 'reject', item.cancelled ? cancelledError() : error)
      } finally {
        this.pendingInputBytes -= item.inputByteLength
        this.activeItem = null
      }
    }
  }

  private async configureQueueItem(item: QueueItem): Promise<LightOcrEngineStatus> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        await this.ensureProcess()
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        return await this.ensureConfigured(item.backend, item.strategy)
      } catch (error) {
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        if (isUnexpectedExit(error) && attempt === 0 && !this.closed) continue
        throw error
      }
    }
    throw new LightOcrProcessHostError('unexpected_exit', 'OCR helper did not recover')
  }

  private async recognizeQueueItem(item: QueueItem): Promise<LightOcrRecognitionResult> {
    if (!item.encoded) throw this.failProtocol('OCR recognition queue item has no input')
    const inputPath = await this.materializeInput(item.encoded)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (item.cancelled || item.signal?.aborted) throw cancelledError()
          await this.ensureProcess()
          if (item.cancelled || item.signal?.aborted) throw cancelledError()
          await this.ensureConfigured(item.backend, item.strategy)
          if (item.cancelled || item.signal?.aborted) throw cancelledError()
          const result = await this.sendRequest(
            { type: 'recognize', id: randomUUID(), filePath: inputPath },
            this.recognitionTimeoutMs
          )
          if (!isLightOcrRecognitionResult(result)) {
            throw this.failProtocol('OCR helper returned an invalid recognition result')
          }
          return result
        } catch (error) {
          if (item.cancelled || item.signal?.aborted) throw cancelledError()
          if (isUnexpectedExit(error) && attempt === 0 && !this.closed) continue
          throw error
        }
      }
      throw new LightOcrProcessHostError('unexpected_exit', 'OCR helper did not recover')
    } finally {
      await rm(inputPath, { force: true })
    }
  }

  private async recognizeDocumentQueueItem(
    item: QueueItem
  ): Promise<LightOcrDocumentRecognitionOutcome> {
    if (!item.documentSnapshot || !item.documentOptions || !item.onDocumentPage) {
      throw this.failProtocol('OCR document queue item is incomplete')
    }
    const inputPath = item.documentSnapshot.filePath
    let observedPage = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        await this.ensureProcess()
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        await this.ensureConfigured(item.backend, item.strategy)
        if (item.cancelled || item.signal?.aborted) throw cancelledError()

        const outcome = await this.sendDocumentRequest(
          {
            type: 'recognize_document',
            id: randomUUID(),
            filePath: inputPath,
            backend: item.backend,
            strategy: item.strategy,
            options: item.documentOptions
          },
          (page) => {
            observedPage = true
            return item.onDocumentPage!(page)
          }
        )
        return outcome
      } catch (error) {
        if (item.cancelled || item.signal?.aborted) throw cancelledError()
        if (isUnexpectedExit(error) && !observedPage && attempt === 0 && !this.closed) continue
        throw error
      }
    }
    throw new LightOcrProcessHostError('unexpected_exit', 'OCR helper did not recover')
  }

  private async ensureProcess(): Promise<void> {
    if (this.stopping) await this.stopping
    if (this.terminatingChildren.size > 0) await Promise.all(this.terminatingChildren)
    if (this.child && !this.starting) return
    if (this.starting) return this.starting
    if (this.closed) throw new LightOcrProcessHostError('closed', 'OCR process host is closed')

    this.starting = this.spawnHelper()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async spawnHelper(): Promise<void> {
    await this.validateRuntimeAssets()
    const tempRoot = await this.ensureTempRoot()
    const nativeRuntimeOverride = await this.resolveNativeRuntimeOverride(tempRoot)
    if (this.closed) throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
    if (this.activeItem?.cancelled || this.activeItem?.signal?.aborted) throw cancelledError()
    const environment = createLightOcrHelperEnvironment(
      process.env,
      this.options.testEnvironment,
      nativeRuntimeOverride
    )

    const child = this.spawnProcess(
      this.options.nodeExecutable,
      [
        this.options.helperEntryPath,
        '--bundle-path',
        this.options.bundlePath,
        '--expected-bundle-id',
        this.options.expectedBundleId,
        '--temp-root',
        tempRoot
      ],
      {
        cwd: tempRoot,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    )

    this.child = child
    this.stdoutSegments = []
    this.stdoutBufferedBytes = 0
    this.stderrTail = Buffer.alloc(0)
    this.stderrBytesCaptured = 0
    this.configuredKey = null
    this.engineStatus = null
    this.nodeVersion = null

    child.stdout.on('data', (chunk: Buffer) => this.acceptStdout(chunk, child))
    child.stderr.on('data', (chunk: Buffer) => this.acceptStderr(chunk, child))
    child.once('error', (error) => {
      if (this.child === child) {
        this.disposeProcess(
          new LightOcrProcessHostError('unexpected_exit', 'OCR helper failed to start', {
            cause: error
          }),
          false
        )
      }
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        this.disposeProcess(
          new LightOcrProcessHostError('unexpected_exit', `OCR helper exited with ${reason}`),
          false
        )
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new LightOcrProcessHostError('timeout', 'OCR helper handshake timed out')
        this.disposeProcess(error, true)
      }, this.initializationTimeoutMs)
      this.handshake = { resolve, reject, timeout }
    })
  }

  private async ensureConfigured(
    backend: LightOcrBackendPreference,
    strategy: LightOcrRecognitionStrategy
  ): Promise<LightOcrEngineStatus> {
    const key = `${backend}:${strategy}`
    if (this.configuredKey === key && this.engineStatus) return structuredClone(this.engineStatus)
    const result = await this.sendRequest(
      { type: 'configure', id: randomUUID(), backend, strategy },
      this.initializationTimeoutMs
    )
    if (!isLightOcrEngineStatus(result) || result.modelBundleId !== this.options.expectedBundleId) {
      throw this.failProtocol('OCR helper returned an invalid engine status')
    }
    this.configuredKey = key
    this.engineStatus = result
    return structuredClone(result)
  }

  private sendDocumentRequest(
    request: Extract<LightOcrHelperRequest, { type: 'recognize_document' }>,
    onPage: (page: LightOcrDocumentPage) => LightOcrDocumentPageAction
  ): Promise<LightOcrDocumentRecognitionOutcome> {
    const child = this.child
    if (!child) {
      return Promise.reject(
        new LightOcrProcessHostError('unexpected_exit', 'OCR helper is not running')
      )
    }
    if (!this.engineStatus) {
      return Promise.reject(
        this.failProtocol('OCR helper document request has no configured engine status')
      )
    }
    const engine = structuredClone(this.engineStatus)

    return new Promise((resolve, reject) => {
      const timeoutDocument = (kind: 'idle' | 'total') => {
        if (!this.pendingDocumentResponses.has(request.id)) return
        const error = new LightOcrProcessHostError(
          'timeout',
          `OCR helper document request exceeded its ${kind} timeout`
        )
        this.disposeProcess(error, true)
      }
      const pending: PendingDocumentResponse = {
        request,
        engine,
        onPage,
        resolve,
        reject,
        idleTimeout: setTimeout(() => timeoutDocument('idle'), this.documentIdleTimeoutMs),
        totalTimeout: setTimeout(() => timeoutDocument('total'), this.documentTotalTimeoutMs),
        expectedNextPageIndex: request.options.pageRange.start - 1,
        receivedPages: 0,
        receivedPixels: 0,
        generationOutputLimitReached: false,
        stopRequestId: null,
        stopAcknowledged: null,
        completion: null
      }
      this.pendingDocumentResponses.set(request.id, pending)
      this.activeWireRequestId = request.id
      this.activeWireRequestType = request.type

      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) return
          this.disposeProcess(
            new LightOcrProcessHostError('unexpected_exit', 'Unable to write to OCR helper', {
              cause: error
            }),
            true
          )
        })
      } catch (error) {
        this.disposeProcess(
          new LightOcrProcessHostError('unexpected_exit', 'Unable to write to OCR helper', {
            cause: error
          }),
          true
        )
      }
    })
  }

  private sendRequest(request: LightOcrHelperRequest, timeoutMs: number): Promise<unknown> {
    const child = this.child
    if (!child) {
      return Promise.reject(
        new LightOcrProcessHostError('unexpected_exit', 'OCR helper is not running')
      )
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(request.id)
        const error = new LightOcrProcessHostError(
          'timeout',
          `OCR helper ${request.type} request timed out`
        )
        this.disposeProcess(error, true)
        reject(error)
      }, timeoutMs)
      this.pendingResponses.set(request.id, { resolve, reject, timeout })
      if (request.type === 'configure' || request.type === 'recognize') {
        this.activeWireRequestId = request.id
        this.activeWireRequestType = request.type
      }

      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) return
          const failure = new LightOcrProcessHostError(
            'unexpected_exit',
            'Unable to write to OCR helper',
            { cause: error }
          )
          this.disposeProcess(failure, true)
        })
      } catch (error) {
        const failure = new LightOcrProcessHostError(
          'unexpected_exit',
          'Unable to write to OCR helper',
          { cause: error }
        )
        this.disposeProcess(failure, true)
      }
    })
  }

  private acceptStdout(chunk: Buffer, child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    let offset = 0
    while (offset < chunk.byteLength) {
      const newlineIndex = chunk.indexOf(0x0a, offset)
      const segmentEnd = newlineIndex >= 0 ? newlineIndex : chunk.byteLength
      const segment = chunk.subarray(offset, segmentEnd)
      if (segment.byteLength > 0) {
        this.stdoutSegments.push(segment)
        this.stdoutBufferedBytes += segment.byteLength
      }
      if (this.stdoutBufferedBytes > LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES) {
        this.failProtocol('OCR helper response exceeded the protocol line limit')
        return
      }

      if (newlineIndex < 0) return
      if (this.stdoutBufferedBytes > 0) {
        const line =
          this.stdoutSegments.length === 1
            ? this.stdoutSegments[0]
            : Buffer.concat(this.stdoutSegments, this.stdoutBufferedBytes)
        this.stdoutSegments = []
        this.stdoutBufferedBytes = 0
        this.acceptMessageLine(line.toString('utf8'))
        if (this.child !== child) return
      }
      offset = newlineIndex + 1
    }
  }

  private acceptStderr(chunk: Buffer, child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.stderrBytesCaptured += chunk.byteLength
    this.stderrTail = Buffer.concat([this.stderrTail, chunk]).subarray(-MAX_STDERR_BYTES)
  }

  private acceptMessageLine(line: string): void {
    let message: LightOcrHelperMessage
    try {
      const parsed = JSON.parse(line) as unknown
      if (!isLightOcrHelperMessage(parsed)) throw new Error('invalid message')
      message = parsed
    } catch {
      this.failProtocol('OCR helper emitted invalid protocol output')
      return
    }

    if (message.type === 'hello') {
      this.acceptHandshake(message)
      return
    }

    if (message.type === 'document_page') {
      this.acceptDocumentPage(message)
      return
    }
    if (message.type === 'request_complete') {
      this.acceptDocumentCompletion(message)
      return
    }
    if (this.pendingDocumentResponses.has(message.id)) {
      if (message.type !== 'error') {
        this.failProtocol('OCR helper emitted an invalid document terminal response')
        return
      }
      this.acceptDocumentError(message)
      return
    }
    if (this.pendingDocumentStops.has(message.id)) {
      this.acceptDocumentStopResponse(message)
      return
    }

    if (this.ignoredResponseIds.delete(message.id)) return
    const pending = this.pendingResponses.get(message.id)
    if (!pending) {
      this.failProtocol('OCR helper emitted a response with an unknown id')
      return
    }
    this.pendingResponses.delete(message.id)
    clearTimeout(pending.timeout)
    if (this.activeWireRequestId === message.id) {
      this.activeWireRequestId = null
      this.activeWireRequestType = null
      this.clearCancelFallback()
    }

    if (message.type === 'result') {
      pending.resolve(message.data)
      return
    }
    const helperError = new LightOcrProcessHostError('helper_error', message.error.message, {
      helperCode: message.error.code,
      detail: message.error.detail
    })
    pending.reject(helperError)
    if (isFatalHelperError(message.error.code)) this.disposeProcess(helperError, true)
  }

  private acceptDocumentPage(
    message: Extract<LightOcrHelperMessage, { type: 'document_page' }>
  ): void {
    const pending = this.pendingDocumentResponses.get(message.id)
    if (!pending) {
      this.failProtocol('OCR helper emitted a document page with an unknown id')
      return
    }
    if (pending.completion) {
      this.failProtocol('OCR helper emitted a document page after completion')
      return
    }
    const { page } = message
    const renderedPixels = page.width * page.height
    if (
      !isLightOcrDocumentPage(page) ||
      page.index !== pending.expectedNextPageIndex ||
      page.index > pending.request.options.pageRange.end - 1 ||
      pending.receivedPages >= pending.request.options.maxPages ||
      renderedPixels > pending.request.options.maxPagePixels ||
      !Number.isSafeInteger(pending.receivedPixels + renderedPixels) ||
      pending.receivedPixels + renderedPixels > pending.request.options.maxTotalPixels ||
      page.modelBundleId !== this.options.expectedBundleId
    ) {
      this.failProtocol('OCR helper emitted an invalid document page sequence')
      return
    }

    pending.expectedNextPageIndex += 1
    pending.receivedPages += 1
    pending.receivedPixels += renderedPixels
    this.resetDocumentIdleTimeout(pending)

    if (pending.generationOutputLimitReached) return

    let action: LightOcrDocumentPageAction
    try {
      action = pending.onPage(page)
    } catch (error) {
      const failure = new LightOcrProcessHostError(
        'page_handler_failed',
        'OCR document page handler failed',
        { cause: error }
      )
      this.settleDocumentResponse(pending, 'reject', failure)
      this.disposeProcess(failure, true)
      return
    }
    if (action !== 'continue' && action !== 'output_limit_reached') {
      const failure = new LightOcrProcessHostError(
        'page_handler_failed',
        'OCR document page handler returned an invalid action'
      )
      this.settleDocumentResponse(pending, 'reject', failure)
      this.disposeProcess(failure, true)
      return
    }
    if (action === 'output_limit_reached') {
      pending.generationOutputLimitReached = true
      this.sendDocumentStop(pending)
    }
  }

  private acceptDocumentCompletion(
    message: Extract<LightOcrHelperMessage, { type: 'request_complete' }>
  ): void {
    const pending = this.pendingDocumentResponses.get(message.id)
    if (!pending) {
      this.failProtocol('OCR helper emitted document completion with an unknown id')
      return
    }
    if (message.emittedPages !== pending.receivedPages || pending.completion) {
      this.failProtocol('OCR helper emitted invalid document completion accounting')
      return
    }

    pending.completion = { emittedPages: message.emittedPages }
    this.clearDocumentResponseTimers(pending)
    this.finishCompletedDocument(pending)
  }

  private acceptDocumentError(message: Extract<LightOcrHelperMessage, { type: 'error' }>): void {
    const pending = this.pendingDocumentResponses.get(message.id)
    if (!pending) {
      this.failProtocol('OCR helper emitted a document error with an unknown id')
      return
    }
    if (pending.completion) {
      this.failProtocol('OCR helper emitted a document error after completion')
      return
    }
    const error = new LightOcrProcessHostError('helper_error', message.error.message, {
      helperCode: message.error.code,
      detail: message.error.detail
    })

    if (message.error.code === 'resource_limit_exceeded' && pending.receivedPages > 0) {
      this.settleDocumentResponse(pending, 'resolve', {
        artifactTermination: 'resource_limited',
        emittedPages: pending.receivedPages,
        generationOutputLimitReached: pending.generationOutputLimitReached,
        engine: structuredClone(pending.engine),
        resourceLimit: {
          code: 'resource_limit_exceeded',
          message: message.error.message,
          ...(message.error.detail ? { detail: message.error.detail } : {})
        }
      })
      return
    }

    this.settleDocumentResponse(pending, 'reject', error)
    if (isFatalHelperError(message.error.code)) this.disposeProcess(error, true)
  }

  private acceptDocumentStopResponse(
    message: Extract<LightOcrHelperMessage, { type: 'result' | 'error' }>
  ): void {
    const stop = this.pendingDocumentStops.get(message.id)
    if (!stop) {
      this.failProtocol('OCR helper emitted a document-stop response with an unknown id')
      return
    }
    this.pendingDocumentStops.delete(message.id)
    clearTimeout(stop.timeout)

    const pending = this.pendingDocumentResponses.get(stop.documentRequestId)
    if (!pending) return
    if (
      pending.stopRequestId !== message.id ||
      message.type !== 'result' ||
      !isDocumentStopResult(message.data)
    ) {
      this.failProtocol('OCR helper emitted an invalid document-stop response')
      return
    }
    pending.stopAcknowledged = message.data.stopped
    this.finishCompletedDocument(pending)
  }

  private finishCompletedDocument(pending: PendingDocumentResponse): void {
    if (!pending.completion) return
    if (pending.stopRequestId && pending.stopAcknowledged === null) return

    this.settleDocumentResponse(pending, 'resolve', {
      artifactTermination:
        pending.stopAcknowledged === true ? 'stopped_by_output_limit' : 'request_complete',
      emittedPages: pending.completion.emittedPages,
      generationOutputLimitReached: pending.generationOutputLimitReached,
      engine: structuredClone(pending.engine)
    })
  }

  private sendDocumentStop(pending: PendingDocumentResponse): void {
    const child = this.child
    if (!child || pending.stopRequestId) return

    const stopRequestId = randomUUID()
    pending.stopRequestId = stopRequestId
    const timeout = setTimeout(() => {
      this.pendingDocumentStops.delete(stopRequestId)
      if (!this.pendingDocumentResponses.has(pending.request.id)) return
      this.disposeProcess(
        new LightOcrProcessHostError('timeout', 'OCR helper document-stop request timed out'),
        true
      )
    }, this.documentStopTimeoutMs)
    this.pendingDocumentStops.set(stopRequestId, {
      documentRequestId: pending.request.id,
      timeout
    })

    try {
      child.stdin.write(
        `${JSON.stringify({
          type: 'document_stop',
          id: stopRequestId,
          targetId: pending.request.id
        })}\n`,
        (error) => {
          if (!error || !this.pendingDocumentResponses.has(pending.request.id)) return
          this.disposeProcess(
            new LightOcrProcessHostError('unexpected_exit', 'Unable to stop OCR document output', {
              cause: error
            }),
            true
          )
        }
      )
    } catch (error) {
      if (!this.pendingDocumentResponses.has(pending.request.id)) return
      this.disposeProcess(
        new LightOcrProcessHostError('unexpected_exit', 'Unable to stop OCR document output', {
          cause: error
        }),
        true
      )
    }
  }

  private resetDocumentIdleTimeout(pending: PendingDocumentResponse): void {
    clearTimeout(pending.idleTimeout)
    pending.idleTimeout = setTimeout(() => {
      if (!this.pendingDocumentResponses.has(pending.request.id)) return
      this.disposeProcess(
        new LightOcrProcessHostError(
          'timeout',
          'OCR helper document request exceeded its idle timeout'
        ),
        true
      )
    }, this.documentIdleTimeoutMs)
  }

  private clearDocumentResponseTimers(pending: PendingDocumentResponse): void {
    clearTimeout(pending.idleTimeout)
    clearTimeout(pending.totalTimeout)
  }

  private settleDocumentResponse(
    pending: PendingDocumentResponse,
    action: 'resolve' | 'reject',
    value: LightOcrDocumentRecognitionOutcome | unknown
  ): void {
    if (this.pendingDocumentResponses.get(pending.request.id) !== pending) return
    this.pendingDocumentResponses.delete(pending.request.id)
    this.clearDocumentResponseTimers(pending)
    if (this.activeWireRequestId === pending.request.id) {
      this.activeWireRequestId = null
      this.activeWireRequestType = null
      this.clearCancelFallback()
    }
    if (action === 'resolve') pending.resolve(value as LightOcrDocumentRecognitionOutcome)
    else pending.reject(value)
  }

  private acceptHandshake(message: Extract<LightOcrHelperMessage, { type: 'hello' }>): void {
    const handshake = this.handshake
    if (!handshake) {
      this.failProtocol('OCR helper emitted an unexpected handshake')
      return
    }
    if (
      message.protocolVersion !== LIGHT_OCR_PROTOCOL_VERSION ||
      message.nodeVersion !== this.expectedNodeVersion
    ) {
      const error = new LightOcrProcessHostError(
        'invalid_protocol',
        `OCR helper handshake mismatch (protocol ${message.protocolVersion}, Node ${message.nodeVersion})`
      )
      this.disposeProcess(error, true)
      return
    }

    clearTimeout(handshake.timeout)
    this.handshake = null
    this.nodeVersion = message.nodeVersion
    handshake.resolve()
  }

  private failProtocol(message: string): LightOcrProcessHostError {
    const error = new LightOcrProcessHostError('invalid_protocol', message)
    this.disposeProcess(error, true)
    return error
  }

  private disposeProcess(error: LightOcrProcessHostError, kill: boolean): void {
    const child = this.child
    this.child = null
    this.configuredKey = null
    this.engineStatus = null
    this.nodeVersion = null
    this.stdoutSegments = []
    this.stdoutBufferedBytes = 0
    this.clearIdleTimer()
    this.clearCancelFallback()

    if (this.handshake) {
      const handshake = this.handshake
      this.handshake = null
      clearTimeout(handshake.timeout)
      handshake.reject(error)
    }
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingResponses.clear()
    for (const pending of this.pendingDocumentResponses.values()) {
      this.clearDocumentResponseTimers(pending)
      pending.reject(error)
    }
    this.pendingDocumentResponses.clear()
    for (const stop of this.pendingDocumentStops.values()) clearTimeout(stop.timeout)
    this.pendingDocumentStops.clear()
    this.ignoredResponseIds.clear()
    this.activeWireRequestId = null
    this.activeWireRequestType = null

    if (child && kill) this.terminateChild(child)
  }

  private cancelQueueItem(item: QueueItem): void {
    if (item.settled) return
    item.cancelled = true
    const queuedIndex = this.queue.indexOf(item)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      this.pendingInputBytes -= item.inputByteLength
      this.settleQueueItem(item, 'reject', cancelledError())
      return
    }
    if (this.activeItem !== item) return

    if (
      (this.activeWireRequestType === 'recognize' ||
        this.activeWireRequestType === 'recognize_document') &&
      this.activeWireRequestId &&
      this.child
    ) {
      const cancelId = randomUUID()
      this.ignoredResponseIds.add(cancelId)
      try {
        this.child.stdin.write(
          `${JSON.stringify({ type: 'cancel', id: cancelId, targetId: this.activeWireRequestId })}\n`,
          (error) => {
            if (error) this.disposeProcess(cancelledError(), true)
          }
        )
      } catch {
        this.disposeProcess(cancelledError(), true)
        return
      }
      this.clearCancelFallback()
      this.cancelFallbackTimer = setTimeout(() => {
        this.disposeProcess(cancelledError(), true)
      }, this.cancelGraceMs)
      this.cancelFallbackTimer.unref()
      return
    }

    this.disposeProcess(cancelledError(), true)
  }

  private settleQueueItem(
    item: QueueItem,
    action: 'resolve' | 'reject',
    value: QueueResult | unknown
  ): void {
    if (item.settled) return
    item.settled = true
    if (item.signal && item.abortListener) {
      item.signal.removeEventListener('abort', item.abortListener)
    }
    if (action === 'resolve') item.resolve(value as QueueResult)
    else item.reject(value)
  }

  private async copyDocumentSourceSnapshot(
    sourcePath: string,
    snapshotPath: string,
    maxFileBytes: number,
    signal?: AbortSignal
  ): Promise<{ byteLength: number; sourceSha256: string }> {
    let sourceHandle
    try {
      sourceHandle = await open(sourcePath, 'r')
    } catch (error) {
      throw new LightOcrProcessHostError('invalid_input', 'Unable to open PDF OCR input', {
        cause: error
      })
    }

    let snapshotHandle
    let snapshotComplete = false
    try {
      const sourceStat = await sourceHandle.stat()
      if (!sourceStat.isFile()) {
        throw new LightOcrProcessHostError('invalid_input', 'PDF OCR input must be a regular file')
      }
      if (sourceStat.size > maxFileBytes) {
        throw new LightOcrProcessHostError(
          'input_too_large',
          'PDF OCR input exceeds the source byte limit'
        )
      }
      if (sourceStat.size === 0) {
        throw new LightOcrProcessHostError('empty_input', 'PDF OCR input is empty')
      }

      try {
        snapshotHandle = await open(snapshotPath, 'wx', 0o600)
      } catch (error) {
        throw new LightOcrProcessHostError(
          'snapshot_io_failed',
          'Unable to create the private PDF OCR snapshot',
          { cause: error }
        )
      }

      const hash = createHash('sha256')
      const chunk = Buffer.allocUnsafe(Math.min(DOCUMENT_SNAPSHOT_CHUNK_BYTES, maxFileBytes + 1))
      let byteLength = 0
      while (true) {
        this.throwIfSnapshotCancelled(signal)
        const readLength = Math.min(chunk.byteLength, maxFileBytes + 1 - byteLength)
        const { bytesRead } = await sourceHandle.read(chunk, 0, readLength, byteLength)
        if (bytesRead === 0) break
        byteLength += bytesRead
        if (byteLength > maxFileBytes) {
          throw new LightOcrProcessHostError(
            'input_too_large',
            'PDF OCR input exceeds the source byte limit'
          )
        }

        const bytes = chunk.subarray(0, bytesRead)
        hash.update(bytes)
        let writeOffset = 0
        while (writeOffset < bytesRead) {
          const { bytesWritten } = await snapshotHandle.write(
            bytes,
            writeOffset,
            bytesRead - writeOffset
          )
          if (bytesWritten <= 0) {
            throw new LightOcrProcessHostError(
              'snapshot_io_failed',
              'Unable to write the private PDF OCR snapshot'
            )
          }
          writeOffset += bytesWritten
        }
      }

      if (byteLength === 0) {
        throw new LightOcrProcessHostError('empty_input', 'PDF OCR input is empty')
      }
      snapshotComplete = true
      return { byteLength, sourceSha256: hash.digest('hex') }
    } catch (error) {
      if (error instanceof LightOcrProcessHostError) throw error
      throw new LightOcrProcessHostError(
        snapshotHandle ? 'snapshot_io_failed' : 'invalid_input',
        'Unable to snapshot PDF OCR input',
        { cause: error }
      )
    } finally {
      await Promise.allSettled([sourceHandle.close(), snapshotHandle?.close()])
      if (!snapshotComplete) await rm(snapshotPath, { force: true })
    }
  }

  private throwIfSnapshotCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw cancelledError()
    if (this.closed) {
      throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
    }
  }

  private async releaseDocumentSourceSnapshot(
    snapshotPath: string,
    expected: { readonly byteLength: number; readonly sourceSha256: string }
  ): Promise<void> {
    const owned = this.documentSnapshots.get(snapshotPath)
    if (
      !owned ||
      owned.byteLength !== expected.byteLength ||
      owned.sourceSha256 !== expected.sourceSha256
    ) {
      return
    }
    await rm(snapshotPath, { force: true })
    this.documentSnapshots.delete(snapshotPath)
  }

  private async materializeInput(encoded: Buffer, extension = '.img'): Promise<string> {
    const tempRoot = await this.ensureTempRoot()
    const inputPath = path.join(tempRoot, `${randomUUID()}${extension}`)
    const handle = await open(inputPath, 'wx', 0o600)
    let written = false
    try {
      await handle.writeFile(encoded)
      written = true
    } finally {
      try {
        await handle.close()
      } finally {
        if (!written) await rm(inputPath, { force: true })
      }
    }
    return inputPath
  }

  private ensureTempRoot(): Promise<string> {
    if (this.tempRoot) return Promise.resolve(this.tempRoot)
    if (this.tempRootPromise) return this.tempRootPromise

    const creation = this.createTempRoot()
    this.tempRootPromise = creation
    creation.then(
      () => {
        if (this.tempRootPromise === creation) this.tempRootPromise = null
      },
      () => {
        if (this.tempRootPromise === creation) this.tempRootPromise = null
      }
    )
    return creation
  }

  private async createTempRoot(): Promise<string> {
    if (this.closed) {
      throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
    }
    await mkdir(this.options.tempBaseDir, { recursive: true, mode: 0o700 })
    const tempRoot = await mkdtemp(path.join(this.options.tempBaseDir, 'deepchat-light-ocr-'))
    try {
      await chmod(tempRoot, 0o700)
      if (this.closed) {
        throw new LightOcrProcessHostError('closed', 'OCR process host is closed')
      }
      this.tempRoot = tempRoot
      return tempRoot
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true })
      throw error
    }
  }

  private async resolveNativeRuntimeOverride(
    tempRoot: string
  ): Promise<LightOcrNativeRuntimeOverride | undefined> {
    if ((this.options.nativePayloadEncoding ?? 'direct') === 'direct') return undefined
    if (!this.options.nativePackageDir) {
      throw new LightOcrProcessHostError(
        'runtime_missing',
        'Bundled OCR native package path is missing'
      )
    }

    this.nativeRuntimePromise ??= materializeLightOcrNativePayload({
      nativePackageDir: this.options.nativePackageDir,
      tempRoot
    })
    try {
      return await this.nativeRuntimePromise
    } catch (error) {
      this.nativeRuntimePromise = null
      throw new LightOcrProcessHostError(
        'runtime_missing',
        'Bundled OCR native payload failed integrity validation',
        { cause: error }
      )
    }
  }

  private async validateRuntimeAssets(): Promise<void> {
    try {
      await access(
        this.options.nodeExecutable,
        process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK
      )
      await access(this.options.helperEntryPath, fsConstants.R_OK)
      const bundleStat = await stat(this.options.bundlePath)
      if (!bundleStat.isDirectory()) throw new Error('bundle path is not a directory')
      if ((this.options.nativePayloadEncoding ?? 'direct') === 'gzip-base64-v1') {
        if (!this.options.nativePackageDir) throw new Error('native package path is missing')
        const nativePackageStat = await stat(this.options.nativePackageDir)
        if (!nativePackageStat.isDirectory())
          throw new Error('native package path is not a directory')
      }
    } catch (error) {
      throw new LightOcrProcessHostError(
        'runtime_missing',
        'Bundled OCR runtime assets are missing',
        {
          cause: error
        }
      )
    }
  }

  private scheduleIdleStop(): void {
    if (!this.child || this.idleTimer || this.idleTimeoutMs <= 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.stopProcessGracefully()
    }, this.idleTimeoutMs)
    this.idleTimer.unref()
  }

  private stopProcessGracefully(): Promise<void> {
    if (this.stopping) return this.stopping
    const stopping = this.performGracefulStop().finally(() => {
      if (this.stopping === stopping) this.stopping = null
    })
    this.stopping = stopping
    return stopping
  }

  private async performGracefulStop(): Promise<void> {
    if (!this.child) return
    try {
      await this.sendRequest({ type: 'shutdown', id: randomUUID() }, this.shutdownGraceMs)
    } catch {
      // The process is disposed below even when graceful shutdown fails.
    }
    this.disposeProcess(new LightOcrProcessHostError('closed', 'OCR helper stopped'), true)
  }

  private terminateChild(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode !== null || child.signalCode !== null) return

    const termination = new Promise<void>((resolve) => {
      let forceKill: NodeJS.Timeout | null = null
      let giveUp: NodeJS.Timeout | null = null
      const finish = () => {
        if (forceKill) clearTimeout(forceKill)
        if (giveUp) clearTimeout(giveUp)
        child.removeListener('exit', finish)
        resolve()
      }

      child.once('exit', finish)
      child.kill('SIGTERM')
      forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, this.shutdownGraceMs)
      giveUp = setTimeout(finish, this.shutdownGraceMs * 2)
      forceKill.unref()
      giveUp.unref()
    })
    this.terminatingChildren.add(termination)
    void termination.then(() => this.terminatingChildren.delete(termination))
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private clearCancelFallback(): void {
    if (!this.cancelFallbackTimer) return
    clearTimeout(this.cancelFallbackTimer)
    this.cancelFallbackTimer = null
  }
}

export function resolveBundledNodeExecutable(
  nodeRuntimePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32'
    ? path.join(nodeRuntimePath, 'node.exe')
    : path.join(nodeRuntimePath, 'bin', 'node')
}

function isUnexpectedExit(error: unknown): boolean {
  return error instanceof LightOcrProcessHostError && error.code === 'unexpected_exit'
}

function isFatalHelperError(code: string): boolean {
  return FATAL_HELPER_ERROR_CODES.has(code)
}

function isDocumentStopResult(value: unknown): value is { stopped: boolean } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).stopped === 'boolean'
  )
}

function isDocumentRecognitionOutcome(value: unknown): value is LightOcrDocumentRecognitionOutcome {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    (candidate.artifactTermination !== 'request_complete' &&
      candidate.artifactTermination !== 'stopped_by_output_limit' &&
      candidate.artifactTermination !== 'resource_limited') ||
    typeof candidate.emittedPages !== 'number' ||
    !Number.isSafeInteger(candidate.emittedPages) ||
    candidate.emittedPages < 0 ||
    typeof candidate.generationOutputLimitReached !== 'boolean' ||
    !isLightOcrEngineStatus(candidate.engine)
  ) {
    return false
  }
  if (
    candidate.artifactTermination === 'stopped_by_output_limit' &&
    !candidate.generationOutputLimitReached
  ) {
    return false
  }
  if (candidate.artifactTermination === 'resource_limited') {
    if (candidate.emittedPages < 1 || !candidate.resourceLimit) return false
    const resourceLimit = candidate.resourceLimit as Record<string, unknown>
    return (
      resourceLimit.code === 'resource_limit_exceeded' &&
      typeof resourceLimit.message === 'string' &&
      (resourceLimit.detail === undefined || typeof resourceLimit.detail === 'string')
    )
  }
  return candidate.resourceLimit === undefined
}

function cancelledError(): LightOcrProcessHostError {
  return new LightOcrProcessHostError('cancelled', 'OCR request was cancelled')
}
