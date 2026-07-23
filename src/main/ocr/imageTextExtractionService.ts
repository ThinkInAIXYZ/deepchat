import { performance } from 'node:perf_hooks'

import { approximateTokenSize } from 'tokenx'

import runtimeVersions from '../../../resources/runtime-versions.json'
import {
  type ImmutableImageSnapshot,
  ImagePreprocessingError,
  OCR_PREPROCESSING_REVISION,
  type PreprocessedOcrImage,
  preprocessImageForOcr,
  readImmutableImageSnapshot
} from './imagePreprocessor'
import {
  type OcrArtifact,
  type OcrArtifactIdentity,
  type OcrArtifactLookup,
  type OcrArtifactStorePort,
  type OcrArtifactValue
} from './ocrArtifactStore'
import {
  OcrExtractionScheduler,
  OcrSchedulerError,
  type OcrExtractionPriority
} from './ocrExtractionScheduler'
import type {
  LightOcrBackendPreference,
  LightOcrEngineStatus,
  LightOcrRecognitionResult,
  LightOcrRecognitionStrategy
} from './lightOcrProtocol'
import {
  LightOcrProcessHostError,
  type LightOcrPrepareInput,
  type LightOcrRecognizeInput
} from './lightOcrProcessHost'
import {
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_OCR_MAX_TOKENS
} from '@shared/types/attachment'

const MAX_TURN_IMAGES = 8
const MAX_TURN_SOURCE_BYTES = 120 * 1024 * 1024
const MAX_PENDING_SOURCE_IMAGES = 8
const MAX_PENDING_SOURCE_BYTES = 120 * 1024 * 1024
const MAX_IMAGE_TEXT_TOKENS = ATTACHMENT_OCR_MAX_TOKENS
const MAX_BATCH_TEXT_TOKENS = 16_000
const TRUNCATION_MARKER = '[… OCR text truncated …]'

export type ImageTextExtractionErrorCode =
  | 'batch_image_limit_exceeded'
  | 'batch_source_bytes_exceeded'
  | 'cancelled'
  | 'queue_full'
  | 'runtime_failure'
  | 'runtime_identity_mismatch'

export class ImageTextExtractionError extends Error {
  constructor(
    readonly code: ImageTextExtractionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ImageTextExtractionError'
  }
}

export interface ImageTextExtractionInput {
  filePath: string
  maxFileSize: number
  backend: LightOcrBackendPreference
  priority?: OcrExtractionPriority
  signal?: AbortSignal
}

export interface ImageTextExtractionResult {
  text: string
  tokenCount: number
  truncated: boolean
  mimeType: string
  imageWidth: number
  imageHeight: number
  strategy: LightOcrRecognitionStrategy
  engine: LightOcrEngineStatus
  cacheHit: boolean
  timingMs: {
    snapshot: number
    preprocessing: number
    recognition: number
    total: number
  }
}

export type ImageTextExtractionBatchItem =
  | { status: 'fulfilled'; value: ImageTextExtractionResult }
  | { status: 'rejected'; reason: unknown }

export interface ImageTextExtractionPort {
  extract(input: ImageTextExtractionInput): Promise<ImageTextExtractionResult>
  extractBatch(inputs: ImageTextExtractionInput[]): Promise<ImageTextExtractionBatchItem[]>
}

export interface LightOcrRecognitionPort {
  prepare(input: LightOcrPrepareInput): Promise<LightOcrEngineStatus>
  recognize(input: LightOcrRecognizeInput): Promise<LightOcrRecognitionResult>
}

export interface ImageTextExtractionServiceOptions {
  processHost: LightOcrRecognitionPort
  artifactStore: OcrArtifactStorePort
  scheduler?: OcrExtractionScheduler
  lightOcrVersion?: string
  bundleId?: string
  preprocessingRevision?: string
  snapshotReader?: typeof readImmutableImageSnapshot
  preprocessor?: typeof preprocessImageForOcr
  onDiagnostic?: (event: { code: 'cache_read_failed' | 'cache_write_failed' }) => void
}

interface SharedExtractionFlight {
  controller: AbortController
  promise: Promise<ImageTextExtractionResult>
  owners: number
  settled: boolean
}

export class ImageTextExtractionService implements ImageTextExtractionPort {
  private readonly scheduler: OcrExtractionScheduler
  private readonly lightOcrVersion: string
  private readonly bundleId: string
  private readonly preprocessingRevision: string
  private readonly snapshotReader: typeof readImmutableImageSnapshot
  private readonly preprocessor: typeof preprocessImageForOcr
  private readonly flights = new Map<string, SharedExtractionFlight>()
  private reservedSourceBytes = 0
  private reservedSourceImages = 0
  private closed = false

  constructor(private readonly options: ImageTextExtractionServiceOptions) {
    this.scheduler = options.scheduler ?? new OcrExtractionScheduler()
    this.lightOcrVersion = options.lightOcrVersion ?? runtimeVersions.lightOcr.version
    this.bundleId = options.bundleId ?? runtimeVersions.lightOcr.bundleId
    this.preprocessingRevision = options.preprocessingRevision ?? OCR_PREPROCESSING_REVISION
    this.snapshotReader = options.snapshotReader ?? readImmutableImageSnapshot
    this.preprocessor = options.preprocessor ?? preprocessImageForOcr
  }

  async extract(input: ImageTextExtractionInput): Promise<ImageTextExtractionResult> {
    this.assertOpen()
    const startedAt = performance.now()
    const snapshotStartedAt = performance.now()
    const snapshot = await this.snapshotReader(input)
    const snapshotMs = performance.now() - snapshotStartedAt
    this.assertOpen()
    this.reserveSnapshot(snapshot)
    try {
      const result = await this.extractSnapshot(snapshot, input)
      return {
        ...result,
        timingMs: {
          ...result.timingMs,
          snapshot: snapshotMs,
          total: performance.now() - startedAt
        }
      }
    } finally {
      this.releaseSnapshot(snapshot)
    }
  }

  async extractBatch(inputs: ImageTextExtractionInput[]): Promise<ImageTextExtractionBatchItem[]> {
    this.assertOpen()
    if (inputs.length > MAX_TURN_IMAGES) {
      throw new ImageTextExtractionError(
        'batch_image_limit_exceeded',
        `OCR accepts at most ${MAX_TURN_IMAGES} images per turn`
      )
    }

    const snapshots: Array<
      | {
          status: 'fulfilled'
          snapshot: ImmutableImageSnapshot
          snapshotMs: number
          reserved: boolean
        }
      | { status: 'rejected'; reason: unknown }
    > = []
    let sourceBytes = 0
    try {
      for (const input of inputs) {
        const startedAt = performance.now()
        try {
          const snapshot = await this.snapshotReader(input)
          sourceBytes += snapshot.bytes.byteLength
          if (sourceBytes > MAX_TURN_SOURCE_BYTES) {
            throw new ImageTextExtractionError(
              'batch_source_bytes_exceeded',
              'OCR image inputs exceed the per-turn source byte limit'
            )
          }
          this.assertOpen()
          this.reserveSnapshot(snapshot)
          snapshots.push({
            status: 'fulfilled',
            snapshot,
            snapshotMs: performance.now() - startedAt,
            reserved: true
          })
        } catch (error) {
          if (error instanceof ImageTextExtractionError) throw error
          if (this.closed) throw error
          snapshots.push({ status: 'rejected', reason: error })
        }
      }

      const results: ImageTextExtractionBatchItem[] = []
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index]
        const snapshotResult = snapshots[index]
        if (snapshotResult.status === 'rejected') {
          results.push(snapshotResult)
          continue
        }
        const startedAt = performance.now()
        try {
          const result = await this.extractSnapshot(snapshotResult.snapshot, input)
          results.push({
            status: 'fulfilled',
            value: {
              ...result,
              timingMs: {
                ...result.timingMs,
                snapshot: snapshotResult.snapshotMs,
                total: performance.now() - startedAt + snapshotResult.snapshotMs
              }
            }
          })
        } catch (error) {
          results.push({ status: 'rejected', reason: error })
        } finally {
          this.releaseSnapshot(snapshotResult.snapshot)
          snapshotResult.reserved = false
        }
      }
      applyBatchTokenBudget(results)
      return results
    } finally {
      for (const snapshot of snapshots) {
        if (snapshot.status === 'fulfilled' && snapshot.reserved) {
          this.releaseSnapshot(snapshot.snapshot)
          snapshot.reserved = false
        }
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const flight of this.flights.values()) flight.controller.abort()
    this.scheduler.close()
  }

  hasActiveExtractions(): boolean {
    return this.flights.size > 0
  }

  private extractSnapshot(
    snapshot: ImmutableImageSnapshot,
    input: ImageTextExtractionInput
  ): Promise<ImageTextExtractionResult> {
    if (input.signal?.aborted) return Promise.reject(cancelledError())
    const flightKey = [
      snapshot.sourceSha256,
      this.lightOcrVersion,
      this.bundleId,
      this.preprocessingRevision,
      input.backend
    ].join(':')
    let flight = this.flights.get(flightKey)
    if (!flight) {
      const controller = new AbortController()
      const promise = this.scheduler.schedule(
        () => this.runExtraction(snapshot, input.backend, controller.signal),
        input.priority ?? 'interactive',
        controller.signal
      )
      flight = { controller, promise, owners: 0, settled: false }
      this.flights.set(flightKey, flight)
      promise.then(
        () => this.finishFlight(flightKey, flight!),
        () => this.finishFlight(flightKey, flight!)
      )
    }
    return this.joinFlight(flightKey, flight, input.signal)
  }

  private async runExtraction(
    snapshot: ImmutableImageSnapshot,
    backend: LightOcrBackendPreference,
    signal: AbortSignal
  ): Promise<ImageTextExtractionResult> {
    const startedAt = performance.now()
    const preprocessingStartedAt = performance.now()
    const preprocessed = await this.preprocessor(snapshot, signal)
    const preprocessingMs = performance.now() - preprocessingStartedAt
    if (preprocessed.preprocessingRevision !== this.preprocessingRevision) {
      throw new ImageTextExtractionError(
        'runtime_identity_mismatch',
        'OCR preprocessing revision does not match the configured cache identity'
      )
    }

    const lookup: OcrArtifactLookup = {
      sourceSha256: snapshot.sourceSha256,
      lightOcrVersion: this.lightOcrVersion,
      bundleId: this.bundleId,
      preprocessingRevision: this.preprocessingRevision,
      strategy: preprocessed.strategy,
      requestedBackend: backend
    }
    const recognitionStartedAt = performance.now()
    let preparedEngine: LightOcrEngineStatus
    try {
      preparedEngine = await this.options.processHost.prepare({
        backend,
        strategy: preprocessed.strategy,
        signal
      })
    } catch (error) {
      throw normalizeRuntimeError(error)
    }
    assertPreparedEngineIdentity(preparedEngine, {
      bundleId: this.bundleId,
      backend,
      strategy: preprocessed.strategy
    })
    const identity = createArtifactIdentity(lookup, preparedEngine)
    const cached = await this.findCachedArtifact(identity)
    if (cached && isCompatibleArtifact(cached, identity, preprocessed)) {
      const limited = truncateOcrText(cached.text, MAX_IMAGE_TEXT_TOKENS)
      const safeCachedArtifact: OcrArtifact = {
        ...cached,
        text: limited.text,
        tokenCount: limited.tokenCount,
        truncated: cached.truncated || limited.truncated
      }
      return resultFromArtifact(safeCachedArtifact, preprocessed.strategy, true, {
        preprocessing: preprocessingMs,
        recognition: performance.now() - recognitionStartedAt,
        total: performance.now() - startedAt
      })
    }

    let recognition: LightOcrRecognitionResult
    try {
      recognition = await this.options.processHost.recognize({
        encoded: preprocessed.encoded,
        backend,
        strategy: preprocessed.strategy,
        signal
      })
    } catch (error) {
      throw normalizeRuntimeError(error)
    }
    const recognitionMs = performance.now() - recognitionStartedAt
    assertRecognitionIdentity(recognition, {
      bundleId: this.bundleId,
      backend,
      strategy: preprocessed.strategy,
      imageWidth: preprocessed.width,
      imageHeight: preprocessed.height,
      preparedEngine
    })

    const normalizedText = normalizeRecognitionText(recognition)
    const limitedText = truncateOcrText(normalizedText, MAX_IMAGE_TEXT_TOKENS)
    const value: OcrArtifactValue = {
      text: limitedText.text,
      tokenCount: limitedText.tokenCount,
      truncated: limitedText.truncated,
      mimeType: preprocessed.mimeType,
      imageWidth: recognition.imageWidth,
      imageHeight: recognition.imageHeight,
      engine: recognition.engine
    }
    await this.storeArtifact(identity, value)
    return resultFromArtifact({ cacheKey: '', ...value }, preprocessed.strategy, false, {
      preprocessing: preprocessingMs,
      recognition: recognitionMs,
      total: performance.now() - startedAt
    })
  }

  private async findCachedArtifact(identity: OcrArtifactIdentity): Promise<OcrArtifact | null> {
    try {
      return await this.options.artifactStore.find(identity)
    } catch {
      this.emitDiagnostic('cache_read_failed')
      return null
    }
  }

  private async storeArtifact(
    identity: OcrArtifactIdentity,
    value: OcrArtifactValue
  ): Promise<void> {
    try {
      await this.options.artifactStore.put(identity, value)
    } catch {
      this.emitDiagnostic('cache_write_failed')
    }
  }

  private joinFlight(
    flightKey: string,
    flight: SharedExtractionFlight,
    signal?: AbortSignal
  ): Promise<ImageTextExtractionResult> {
    flight.owners += 1
    return new Promise<ImageTextExtractionResult>((resolve, reject) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        if (signal) signal.removeEventListener('abort', onAbort)
        flight.owners -= 1
        if (flight.owners === 0 && !flight.settled) {
          flight.controller.abort()
          if (this.flights.get(flightKey) === flight) this.flights.delete(flightKey)
        }
      }
      const onAbort = () => {
        finish()
        reject(cancelledError())
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      flight.promise.then(
        (value) => {
          if (!finished) resolve(cloneExtractionResult(value))
          finish()
        },
        (error) => {
          if (!finished) reject(normalizeRuntimeError(error))
          finish()
        }
      )
    })
  }

  private finishFlight(key: string, flight: SharedExtractionFlight): void {
    flight.settled = true
    if (this.flights.get(key) === flight) this.flights.delete(key)
  }

  private emitDiagnostic(code: 'cache_read_failed' | 'cache_write_failed'): void {
    try {
      this.options.onDiagnostic?.({ code })
    } catch {
      // Diagnostics are best-effort and must not change attachment preparation semantics.
    }
  }

  private reserveSnapshot(snapshot: ImmutableImageSnapshot): void {
    if (
      this.reservedSourceImages >= MAX_PENDING_SOURCE_IMAGES ||
      this.reservedSourceBytes + snapshot.bytes.byteLength > MAX_PENDING_SOURCE_BYTES
    ) {
      throw new ImageTextExtractionError(
        'queue_full',
        'OCR extraction queue has reached its source snapshot limit'
      )
    }
    this.reservedSourceImages += 1
    this.reservedSourceBytes += snapshot.bytes.byteLength
  }

  private releaseSnapshot(snapshot: ImmutableImageSnapshot): void {
    this.reservedSourceImages = Math.max(0, this.reservedSourceImages - 1)
    this.reservedSourceBytes = Math.max(0, this.reservedSourceBytes - snapshot.bytes.byteLength)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Image text extraction service is closed')
  }
}

export function truncateOcrText(
  input: string,
  maxTokens: number
): { text: string; tokenCount: number; truncated: boolean } {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    return { text: '', tokenCount: 0, truncated: input.length > 0 }
  }
  if (input.length <= ATTACHMENT_OCR_MAX_TEXT_CHARACTERS) {
    const fullTokenCount = estimateTokens(input)
    if (fullTokenCount <= maxTokens) {
      return { text: input, tokenCount: fullTokenCount, truncated: false }
    }
  }

  let low = 0
  let high = Math.min(
    Math.floor(input.length / 2),
    Math.max(0, Math.floor((ATTACHMENT_OCR_MAX_TEXT_CHARACTERS - TRUNCATION_MARKER.length - 2) / 2))
  )
  let best = estimateTokens(TRUNCATION_MARKER) <= maxTokens ? TRUNCATION_MARKER : ''
  while (low <= high) {
    const retainedCharacters = Math.floor((low + high) / 2)
    const candidate = buildHeadTailText(input, retainedCharacters)
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate
      low = retainedCharacters + 1
    } else {
      high = retainedCharacters - 1
    }
  }
  return { text: best, tokenCount: estimateTokens(best), truncated: true }
}

function normalizeRecognitionText(recognition: LightOcrRecognitionResult): string {
  return recognition.lines
    .map((line) => line.text.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

function buildHeadTailText(text: string, retainedCharacters: number): string {
  if (retainedCharacters <= 0) return TRUNCATION_MARKER
  let headEnd = retainedCharacters
  if (isHighSurrogate(text.charCodeAt(headEnd - 1))) headEnd -= 1
  let tailStart = Math.max(0, text.length - retainedCharacters)
  if (isLowSurrogate(text.charCodeAt(tailStart))) tailStart += 1
  const headLineBreak = text.lastIndexOf('\n', headEnd - 1)
  const tailLineBreak = text.indexOf('\n', tailStart)
  if (headLineBreak > 0 && tailLineBreak >= headLineBreak) {
    const lineHead = text.slice(0, headLineBreak).trimEnd()
    const lineTail = text.slice(tailLineBreak + 1).trimStart()
    if (lineHead && lineTail) return `${lineHead}\n${TRUNCATION_MARKER}\n${lineTail}`
  }
  const head = text.slice(0, headEnd).trimEnd()
  const tail = text.slice(tailStart).trimStart()
  return `${head}\n${TRUNCATION_MARKER}\n${tail}`
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function estimateTokens(text: string): number {
  try {
    const estimate = approximateTokenSize(text)
    if (Number.isFinite(estimate) && estimate >= 0 && (text.length === 0 || estimate > 0)) {
      return Math.ceil(estimate)
    }
  } catch {
    // Fall through to a conservative byte-level bound.
  }
  return Buffer.byteLength(text, 'utf8')
}

function applyBatchTokenBudget(results: ImageTextExtractionBatchItem[]): void {
  const fulfilled = results.filter(
    (item): item is Extract<ImageTextExtractionBatchItem, { status: 'fulfilled' }> =>
      item.status === 'fulfilled'
  )
  let remainingTokens = MAX_BATCH_TEXT_TOKENS
  for (let index = 0; index < fulfilled.length; index += 1) {
    const remainingItems = fulfilled.length - index
    const budget = Math.min(
      MAX_IMAGE_TEXT_TOKENS,
      Math.max(0, Math.floor(remainingTokens / remainingItems))
    )
    const limited = truncateOcrText(fulfilled[index].value.text, budget)
    fulfilled[index].value.text = limited.text
    fulfilled[index].value.tokenCount = limited.tokenCount
    fulfilled[index].value.truncated ||= limited.truncated
    remainingTokens = Math.max(0, remainingTokens - limited.tokenCount)
  }
}

function isCompatibleArtifact(
  artifact: OcrArtifact,
  identity: OcrArtifactIdentity,
  preprocessed: PreprocessedOcrImage
): boolean {
  return (
    artifact.engine.modelBundleId === identity.bundleId &&
    artifact.engine.requestedProvider === identity.requestedBackend &&
    artifact.engine.strategy === identity.strategy &&
    sameStringArray(
      artifact.engine.detection.actualProviderChain,
      identity.detectionProviderChain
    ) &&
    artifact.engine.detection.precision === identity.detectionPrecision &&
    sameStringArray(
      artifact.engine.recognition.actualProviderChain,
      identity.recognitionProviderChain
    ) &&
    artifact.engine.recognition.precision === identity.recognitionPrecision &&
    artifact.mimeType === preprocessed.mimeType &&
    artifact.imageWidth === preprocessed.width &&
    artifact.imageHeight === preprocessed.height
  )
}

function createArtifactIdentity(
  lookup: OcrArtifactLookup,
  engine: LightOcrEngineStatus
): OcrArtifactIdentity {
  return {
    ...lookup,
    detectionProviderChain: [...engine.detection.actualProviderChain],
    detectionPrecision: engine.detection.precision,
    recognitionProviderChain: [...engine.recognition.actualProviderChain],
    recognitionPrecision: engine.recognition.precision
  }
}

function resultFromArtifact(
  artifact: OcrArtifact,
  strategy: LightOcrRecognitionStrategy,
  cacheHit: boolean,
  timing: Omit<ImageTextExtractionResult['timingMs'], 'snapshot'>
): ImageTextExtractionResult {
  return {
    text: artifact.text,
    tokenCount: artifact.tokenCount,
    truncated: artifact.truncated,
    mimeType: artifact.mimeType,
    imageWidth: artifact.imageWidth,
    imageHeight: artifact.imageHeight,
    strategy,
    engine: structuredClone(artifact.engine),
    cacheHit,
    timingMs: { snapshot: 0, ...timing }
  }
}

function assertRecognitionIdentity(
  recognition: LightOcrRecognitionResult,
  expected: {
    bundleId: string
    backend: LightOcrBackendPreference
    strategy: LightOcrRecognitionStrategy
    imageWidth: number
    imageHeight: number
    preparedEngine: LightOcrEngineStatus
  }
): void {
  if (
    recognition.modelBundleId !== expected.bundleId ||
    recognition.engine.modelBundleId !== expected.bundleId ||
    recognition.engine.requestedProvider !== expected.backend ||
    recognition.engine.strategy !== expected.strategy ||
    !hasSameExecutionIdentity(recognition.engine, expected.preparedEngine) ||
    recognition.imageWidth !== expected.imageWidth ||
    recognition.imageHeight !== expected.imageHeight
  ) {
    throw new ImageTextExtractionError(
      'runtime_identity_mismatch',
      'OCR runtime result does not match the requested configuration'
    )
  }
}

function assertPreparedEngineIdentity(
  engine: LightOcrEngineStatus,
  expected: {
    bundleId: string
    backend: LightOcrBackendPreference
    strategy: LightOcrRecognitionStrategy
  }
): void {
  if (
    engine.modelBundleId !== expected.bundleId ||
    engine.requestedProvider !== expected.backend ||
    engine.strategy !== expected.strategy
  ) {
    throw new ImageTextExtractionError(
      'runtime_identity_mismatch',
      'OCR runtime configuration does not match the requested identity'
    )
  }
}

function hasSameExecutionIdentity(
  left: LightOcrEngineStatus,
  right: LightOcrEngineStatus
): boolean {
  return (
    sameStringArray(left.detection.actualProviderChain, right.detection.actualProviderChain) &&
    left.detection.precision === right.detection.precision &&
    sameStringArray(left.recognition.actualProviderChain, right.recognition.actualProviderChain) &&
    left.recognition.precision === right.recognition.precision
  )
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeRuntimeError(error: unknown): Error {
  if (
    error instanceof ImageTextExtractionError ||
    error instanceof ImagePreprocessingError ||
    error instanceof LightOcrProcessHostError
  ) {
    return error
  }
  if (error instanceof OcrSchedulerError && error.code === 'cancelled') return cancelledError()
  if (error instanceof OcrSchedulerError && error.code === 'queue_full') {
    return new ImageTextExtractionError('queue_full', 'OCR extraction queue is full')
  }
  return new ImageTextExtractionError('runtime_failure', 'OCR extraction failed', { cause: error })
}

function cancelledError(): ImageTextExtractionError {
  return new ImageTextExtractionError('cancelled', 'OCR extraction was cancelled')
}

function cloneExtractionResult(result: ImageTextExtractionResult): ImageTextExtractionResult {
  return structuredClone(result)
}
