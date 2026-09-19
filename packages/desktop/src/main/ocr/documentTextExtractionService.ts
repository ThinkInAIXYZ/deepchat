import { performance } from 'node:perf_hooks'

import runtimeVersions from '../../../resources/runtime-versions.json'
import {
  DocumentOcrTextAssembler,
  PDF_OCR_ARTIFACT_REVISION,
  PDF_OCR_GENERATION_MAX_TOKENS,
  PDF_OCR_STRATEGY,
  isDocumentOcrBudgetCompatible,
  isValidDocumentOcrArtifact,
  truncateDocumentOcrArtifact,
  type DocumentOcrArtifact,
  type DocumentOcrArtifactIdentity,
  type DocumentOcrArtifactValue
} from './documentOcrArtifact'
import type { DocumentOcrArtifactStorePort } from './ocrArtifactStore'
import {
  OcrExtractionScheduler,
  OcrSchedulerError,
  type OcrExtractionPriority
} from './ocrExtractionScheduler'
import {
  LIGHT_OCR_DOCUMENT_MAX_PAGES,
  LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS,
  LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  type LightOcrBackendPreference,
  type LightOcrDocumentOptions,
  type LightOcrEngineStatus
} from './lightOcrProtocol'
import {
  LightOcrProcessHostError,
  type LightOcrCreateDocumentSourceSnapshotInput,
  type LightOcrDocumentSourceSnapshot,
  type LightOcrPrepareInput,
  type LightOcrRecognizeDocumentInput,
  type LightOcrDocumentRecognitionOutcome
} from './lightOcrProcessHost'
import { OcrSourceSnapshotBudget, OcrSourceSnapshotBudgetError } from './ocrSourceSnapshotBudget'
import { PDF_PAGE_COUNT_SANITY_LIMIT } from '@shared/types/attachment'

const PDF_OCR_DPI = 150
const PDF_OCR_PAGE_RANGE = { start: 1, end: LIGHT_OCR_DOCUMENT_MAX_PAGES } as const

export type DocumentTextExtractionErrorCode =
  | 'cancelled'
  | 'empty_input'
  | 'input_too_large'
  | 'invalid_input'
  | 'queue_full'
  | 'runtime_failure'
  | 'runtime_identity_mismatch'

export class DocumentTextExtractionError extends Error {
  constructor(
    readonly code: DocumentTextExtractionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DocumentTextExtractionError'
  }
}

export type ImmutablePdfSnapshot = LightOcrDocumentSourceSnapshot

export interface DocumentTextExtractionInput {
  readonly filePath: string
  readonly maxFileSize: number
  readonly backend: LightOcrBackendPreference
  readonly sourcePageCountHint?: number
  readonly generationTokenLimit?: number
  readonly priority?: OcrExtractionPriority
  readonly signal?: AbortSignal
}

export interface DocumentTextExtractionResult extends DocumentOcrArtifactValue {
  readonly cacheHit: boolean
  readonly timingMs: {
    readonly snapshot: number
    readonly recognition: number
    readonly total: number
  }
}

export interface DocumentTextExtractionPort {
  extractDocument(input: DocumentTextExtractionInput): Promise<DocumentTextExtractionResult>
}

export interface LightOcrDocumentRecognitionPort {
  createDocumentSourceSnapshot(
    input: LightOcrCreateDocumentSourceSnapshotInput
  ): Promise<LightOcrDocumentSourceSnapshot>
  prepare(input: LightOcrPrepareInput): Promise<LightOcrEngineStatus>
  recognizeDocument(
    input: LightOcrRecognizeDocumentInput
  ): Promise<LightOcrDocumentRecognitionOutcome>
}

export interface DocumentTextExtractionServiceOptions {
  readonly processHost: LightOcrDocumentRecognitionPort
  readonly artifactStore: DocumentOcrArtifactStorePort
  readonly scheduler?: OcrExtractionScheduler
  readonly closeSchedulerOnClose?: boolean
  readonly snapshotBudget?: OcrSourceSnapshotBudget
  readonly facadeVersion?: string
  readonly runtimeVersion?: string
  readonly nativeVersion?: string
  readonly modelVersion?: string
  readonly bundleId?: string
  readonly artifactRevision?: string
  readonly snapshotReader?: (
    input: LightOcrCreateDocumentSourceSnapshotInput
  ) => Promise<LightOcrDocumentSourceSnapshot>
  readonly onDiagnostic?: (event: { code: 'cache_read_failed' | 'cache_write_failed' }) => void
}

interface SharedDocumentExtractionFlight {
  readonly controller: AbortController
  readonly promise: Promise<DocumentTextExtractionResult>
  readonly snapshot: ImmutablePdfSnapshot
  owners: number
  settled: boolean
}

export class DocumentTextExtractionService implements DocumentTextExtractionPort {
  private readonly scheduler: OcrExtractionScheduler
  private readonly closeSchedulerOnClose: boolean
  private readonly snapshotBudget: OcrSourceSnapshotBudget
  private readonly facadeVersion: string
  private readonly runtimeVersion: string
  private readonly nativeVersion: string
  private readonly modelVersion: string
  private readonly bundleId: string
  private readonly artifactRevision: string
  private readonly snapshotReader: (
    input: LightOcrCreateDocumentSourceSnapshotInput
  ) => Promise<LightOcrDocumentSourceSnapshot>
  private readonly flights = new Map<string, SharedDocumentExtractionFlight>()
  private readonly closeController = new AbortController()
  private activeSnapshotCreations = 0
  private closed = false

  constructor(private readonly options: DocumentTextExtractionServiceOptions) {
    this.scheduler = options.scheduler ?? new OcrExtractionScheduler()
    this.closeSchedulerOnClose = options.closeSchedulerOnClose ?? true
    this.snapshotBudget = options.snapshotBudget ?? new OcrSourceSnapshotBudget()
    this.facadeVersion = options.facadeVersion ?? runtimeVersions.lightOcr.facadeVersion
    this.runtimeVersion = options.runtimeVersion ?? runtimeVersions.lightOcr.runtimeVersion
    this.nativeVersion = options.nativeVersion ?? runtimeVersions.lightOcr.nativeVersion
    this.modelVersion = options.modelVersion ?? runtimeVersions.lightOcr.modelVersion
    this.bundleId = options.bundleId ?? runtimeVersions.lightOcr.bundleId
    this.artifactRevision = options.artifactRevision ?? PDF_OCR_ARTIFACT_REVISION
    this.snapshotReader =
      options.snapshotReader ??
      ((input) => this.options.processHost.createDocumentSourceSnapshot(input))
  }

  async extractDocument(input: DocumentTextExtractionInput): Promise<DocumentTextExtractionResult> {
    this.assertOpen()
    const generationTokenLimit = normalizeGenerationTokenLimit(input.generationTokenLimit)
    const sourcePageCountHint = normalizeSourcePageCountHint(input.sourcePageCountHint)
    const effectiveMaxFileBytes = normalizeDocumentSourceByteLimit(input.maxFileSize)
    const startedAt = performance.now()
    const snapshotStartedAt = performance.now()
    // Reserve the declared maximum before copying so concurrent disk snapshots cannot bypass the
    // shared pending-source budget. The reservation is reduced to the actual immutable size below.
    this.reserveSnapshotBytes(effectiveMaxFileBytes)
    let reservedSnapshotBytes = effectiveMaxFileBytes
    const snapshotSignal = input.signal
      ? AbortSignal.any([input.signal, this.closeController.signal])
      : this.closeController.signal
    this.activeSnapshotCreations += 1
    let snapshot: ImmutablePdfSnapshot
    try {
      snapshot = await this.snapshotReader({
        filePath: input.filePath,
        maxFileBytes: effectiveMaxFileBytes,
        signal: snapshotSignal
      })
    } catch (error) {
      this.snapshotBudget.release(reservedSnapshotBytes)
      throw normalizeRuntimeError(error)
    } finally {
      this.activeSnapshotCreations -= 1
    }
    const snapshotMs = performance.now() - snapshotStartedAt
    try {
      this.assertOpen()
      this.snapshotBudget.release(reservedSnapshotBytes)
      reservedSnapshotBytes = 0
      this.reserveSnapshotBytes(snapshot.byteLength)
    } catch (error) {
      this.snapshotBudget.release(reservedSnapshotBytes)
      await snapshot.release().catch(() => undefined)
      throw error
    }

    const result = await this.extractSnapshot(snapshot, {
      ...input,
      sourcePageCountHint,
      generationTokenLimit,
      maxFileBytes: effectiveMaxFileBytes
    })
    return {
      ...result,
      timingMs: {
        ...result.timingMs,
        snapshot: snapshotMs,
        total: performance.now() - startedAt
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeController.abort()
    for (const flight of this.flights.values()) flight.controller.abort()
    if (this.closeSchedulerOnClose) this.scheduler.close()
  }

  hasActiveExtractions(): boolean {
    return this.activeSnapshotCreations > 0 || this.flights.size > 0
  }

  private async extractSnapshot(
    snapshot: ImmutablePdfSnapshot,
    input: DocumentTextExtractionInput & {
      generationTokenLimit: number
      maxFileBytes: number
    }
  ): Promise<DocumentTextExtractionResult> {
    let releaseUnusedSnapshot = true
    try {
      if (input.signal?.aborted) throw cancelledError()
      const flightKey = JSON.stringify([
        snapshot.sourceSha256,
        this.facadeVersion,
        this.runtimeVersion,
        this.nativeVersion,
        this.modelVersion,
        this.bundleId,
        this.artifactRevision,
        input.backend,
        input.maxFileBytes,
        input.generationTokenLimit,
        input.sourcePageCountHint
      ])
      let flight = this.flights.get(flightKey)
      if (flight) {
        releaseUnusedSnapshot = false
        await this.releaseSnapshot(snapshot)
        return await this.joinFlight(flightKey, flight, input.signal)
      }
      if (!flight) {
        const controller = new AbortController()
        const promise = this.scheduler.schedule(
          () =>
            this.runExtraction(
              snapshot,
              input.backend,
              input.maxFileBytes,
              input.generationTokenLimit,
              input.sourcePageCountHint,
              controller.signal
            ),
          input.priority ?? 'interactive',
          controller.signal
        )
        flight = { controller, promise, snapshot, owners: 0, settled: false }
        releaseUnusedSnapshot = false
        this.flights.set(flightKey, flight)
        promise.then(
          () => this.finishFlight(flightKey, flight!),
          () => this.finishFlight(flightKey, flight!)
        )
      }
      return await this.joinFlight(flightKey, flight, input.signal)
    } finally {
      if (releaseUnusedSnapshot) await this.releaseSnapshot(snapshot)
    }
  }

  private async runExtraction(
    snapshot: ImmutablePdfSnapshot,
    backend: LightOcrBackendPreference,
    maxFileBytes: number,
    generationTokenLimit: number,
    sourcePageCountHint: number | undefined,
    signal: AbortSignal
  ): Promise<DocumentTextExtractionResult> {
    const startedAt = performance.now()
    const recognitionStartedAt = performance.now()
    let preparedEngine: LightOcrEngineStatus
    try {
      preparedEngine = await this.options.processHost.prepare({
        backend,
        strategy: PDF_OCR_STRATEGY,
        signal
      })
    } catch (error) {
      throw normalizeRuntimeError(error)
    }
    assertEngineIdentity(preparedEngine, {
      bundleId: this.bundleId,
      backend,
      strategy: PDF_OCR_STRATEGY
    })

    const documentOptions = createDocumentOptions(maxFileBytes)
    const identity = createDocumentArtifactIdentity(
      snapshot.sourceSha256,
      preparedEngine,
      documentOptions,
      {
        facadeVersion: this.facadeVersion,
        runtimeVersion: this.runtimeVersion,
        nativeVersion: this.nativeVersion,
        modelVersion: this.modelVersion,
        bundleId: this.bundleId,
        artifactRevision: this.artifactRevision,
        backend
      }
    )
    const cached = await this.findCachedArtifact(identity)
    if (cached && isDocumentOcrBudgetCompatible(cached, generationTokenLimit)) {
      const bounded = withSourcePageCountHint(
        truncateDocumentOcrArtifact(cached, generationTokenLimit),
        sourcePageCountHint
      )
      if (!isValidDocumentOcrArtifact(bounded, identity)) {
        throw new DocumentTextExtractionError(
          'runtime_identity_mismatch',
          'Cached document OCR coverage is invalid after budget application'
        )
      }
      return resultFromArtifact(bounded, true, {
        recognition: performance.now() - recognitionStartedAt,
        total: performance.now() - startedAt
      })
    }

    const assembler = new DocumentOcrTextAssembler(
      documentOptions.pageRange.start,
      generationTokenLimit
    )
    let outcome: LightOcrDocumentRecognitionOutcome
    try {
      outcome = await this.options.processHost.recognizeDocument({
        snapshot,
        backend,
        strategy: PDF_OCR_STRATEGY,
        options: documentOptions,
        signal,
        onPage: (page) => assembler.append(page)
      })
    } catch (error) {
      throw normalizeRuntimeError(error)
    }
    assertEngineIdentity(outcome.engine, {
      bundleId: this.bundleId,
      backend,
      strategy: PDF_OCR_STRATEGY
    })
    if (!hasSameExecutionIdentity(preparedEngine, outcome.engine)) {
      throw new DocumentTextExtractionError(
        'runtime_identity_mismatch',
        'Document OCR execution identity changed after cache lookup'
      )
    }

    const assembled = assembler.snapshot()
    if (
      assembled.truncated !== outcome.generationOutputLimitReached ||
      outcome.emittedPages < assembled.pageSpans.length ||
      (!outcome.generationOutputLimitReached && outcome.emittedPages !== assembled.pageSpans.length)
    ) {
      throw new DocumentTextExtractionError(
        'runtime_identity_mismatch',
        'Document OCR stream coverage does not match its terminal accounting'
      )
    }

    const value: DocumentOcrArtifactValue = {
      text: assembled.text,
      tokenCount: assembled.tokenCount,
      pageSpans: assembled.pageSpans,
      artifactTermination: outcome.artifactTermination,
      generationOutputLimitReached: outcome.generationOutputLimitReached,
      generationTokenLimit,
      emittedPages: outcome.emittedPages,
      ...(sourcePageCountHint ? { sourcePageCountHint } : {}),
      ...(outcome.resourceLimit ? { resourceLimit: { ...outcome.resourceLimit } } : {}),
      engine: structuredClone(outcome.engine)
    }
    if (!isValidDocumentOcrArtifact(value, identity)) {
      throw new DocumentTextExtractionError(
        'runtime_identity_mismatch',
        'Document OCR produced an invalid cache artifact'
      )
    }
    await this.storeArtifact(identity, value)
    return resultFromArtifact(value, false, {
      recognition: performance.now() - recognitionStartedAt,
      total: performance.now() - startedAt
    })
  }

  private async findCachedArtifact(
    identity: DocumentOcrArtifactIdentity
  ): Promise<DocumentOcrArtifact | null> {
    try {
      return await this.options.artifactStore.findDocument(identity)
    } catch {
      this.emitDiagnostic('cache_read_failed')
      return null
    }
  }

  private async storeArtifact(
    identity: DocumentOcrArtifactIdentity,
    value: DocumentOcrArtifactValue
  ): Promise<void> {
    try {
      await this.options.artifactStore.putDocument(identity, value)
    } catch {
      this.emitDiagnostic('cache_write_failed')
    }
  }

  private joinFlight(
    flightKey: string,
    flight: SharedDocumentExtractionFlight,
    signal?: AbortSignal
  ): Promise<DocumentTextExtractionResult> {
    flight.owners += 1
    return new Promise<DocumentTextExtractionResult>((resolve, reject) => {
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

  private finishFlight(key: string, flight: SharedDocumentExtractionFlight): void {
    flight.settled = true
    if (this.flights.get(key) === flight) this.flights.delete(key)
    void this.releaseSnapshot(flight.snapshot)
  }

  private emitDiagnostic(code: 'cache_read_failed' | 'cache_write_failed'): void {
    try {
      this.options.onDiagnostic?.({ code })
    } catch {
      // Diagnostics are best-effort and must not change attachment preparation semantics.
    }
  }

  private reserveSnapshotBytes(byteLength: number): void {
    try {
      this.snapshotBudget.reserve(byteLength)
    } catch (error) {
      if (!(error instanceof OcrSourceSnapshotBudgetError)) throw error
      throw new DocumentTextExtractionError(
        'queue_full',
        'OCR extraction queue has reached its source snapshot limit'
      )
    }
  }

  private async releaseSnapshot(snapshot: ImmutablePdfSnapshot): Promise<void> {
    this.snapshotBudget.release(snapshot.byteLength)
    await snapshot.release().catch(() => undefined)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Document text extraction service is closed')
  }
}

export function normalizeDocumentSourceByteLimit(maxFileSize: number): number {
  if (!Number.isFinite(maxFileSize) || maxFileSize <= 0) {
    throw new DocumentTextExtractionError('invalid_input', 'PDF OCR source byte limit is invalid')
  }
  return Math.min(Math.floor(maxFileSize), LIGHT_OCR_HELPER_MAX_INPUT_BYTES)
}

function createDocumentOptions(maxFileBytes: number): LightOcrDocumentOptions {
  return {
    dpi: PDF_OCR_DPI,
    pageRange: { ...PDF_OCR_PAGE_RANGE },
    maxPages: LIGHT_OCR_DOCUMENT_MAX_PAGES,
    maxFileBytes,
    maxPagePixels: LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
    maxTotalPixels: LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS
  }
}

function createDocumentArtifactIdentity(
  sourceSha256: string,
  engine: LightOcrEngineStatus,
  documentOptions: LightOcrDocumentOptions,
  versions: {
    facadeVersion: string
    runtimeVersion: string
    nativeVersion: string
    modelVersion: string
    bundleId: string
    artifactRevision: string
    backend: LightOcrBackendPreference
  }
): DocumentOcrArtifactIdentity {
  return {
    sourceSha256,
    facadeVersion: versions.facadeVersion,
    runtimeVersion: versions.runtimeVersion,
    nativeVersion: versions.nativeVersion,
    modelVersion: versions.modelVersion,
    bundleId: versions.bundleId,
    artifactRevision: versions.artifactRevision,
    strategy: PDF_OCR_STRATEGY,
    requestedBackend: versions.backend,
    detectionProviderChain: [...engine.detection.actualProviderChain],
    detectionPrecision: engine.detection.precision,
    recognitionProviderChain: [...engine.recognition.actualProviderChain],
    recognitionPrecision: engine.recognition.precision,
    dpi: documentOptions.dpi,
    pageRangeStart: documentOptions.pageRange.start,
    pageRangeEnd: documentOptions.pageRange.end,
    maxPages: documentOptions.maxPages,
    maxFileBytes: documentOptions.maxFileBytes,
    maxPagePixels: documentOptions.maxPagePixels,
    maxTotalPixels: documentOptions.maxTotalPixels
  }
}

function resultFromArtifact(
  artifact: DocumentOcrArtifactValue,
  cacheHit: boolean,
  timing: Omit<DocumentTextExtractionResult['timingMs'], 'snapshot'>
): DocumentTextExtractionResult {
  return {
    ...structuredClone(artifact),
    cacheHit,
    timingMs: { snapshot: 0, ...timing }
  }
}

function withSourcePageCountHint(
  artifact: DocumentOcrArtifactValue,
  sourcePageCountHint: number | undefined
): DocumentOcrArtifactValue {
  const { sourcePageCountHint: _cachedHint, ...withoutHint } = artifact
  return {
    ...withoutHint,
    ...(sourcePageCountHint ? { sourcePageCountHint } : {})
  }
}

function assertEngineIdentity(
  engine: LightOcrEngineStatus,
  expected: {
    bundleId: string
    backend: LightOcrBackendPreference
    strategy: typeof PDF_OCR_STRATEGY
  }
): void {
  if (
    engine.modelBundleId !== expected.bundleId ||
    engine.requestedProvider !== expected.backend ||
    engine.strategy !== expected.strategy
  ) {
    throw new DocumentTextExtractionError(
      'runtime_identity_mismatch',
      'Document OCR runtime configuration does not match the requested identity'
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

function normalizeRuntimeError(error: unknown): Error {
  if (error instanceof DocumentTextExtractionError) return error
  if (error instanceof LightOcrProcessHostError) {
    if (error.code === 'cancelled') return cancelledError()
    if (
      error.code === 'empty_input' ||
      error.code === 'input_too_large' ||
      error.code === 'invalid_input'
    ) {
      return new DocumentTextExtractionError(error.code, error.message, { cause: error })
    }
    return error
  }
  if (error instanceof OcrSchedulerError && error.code === 'cancelled') return cancelledError()
  if (error instanceof OcrSchedulerError && error.code === 'queue_full') {
    return new DocumentTextExtractionError('queue_full', 'OCR extraction queue is full')
  }
  return new DocumentTextExtractionError('runtime_failure', 'Document OCR extraction failed', {
    cause: error
  })
}

function normalizeGenerationTokenLimit(value: number | undefined): number {
  const limit = value ?? PDF_OCR_GENERATION_MAX_TOKENS
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > PDF_OCR_GENERATION_MAX_TOKENS) {
    throw new DocumentTextExtractionError(
      'invalid_input',
      'Document OCR generation token limit is invalid'
    )
  }
  return limit
}

function normalizeSourcePageCountHint(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0 || value > PDF_PAGE_COUNT_SANITY_LIMIT) {
    throw new DocumentTextExtractionError('invalid_input', 'PDF source page count hint is invalid')
  }
  return value
}

function cancelledError(): DocumentTextExtractionError {
  return new DocumentTextExtractionError('cancelled', 'Document OCR extraction was cancelled')
}

function cloneExtractionResult(result: DocumentTextExtractionResult): DocumentTextExtractionResult {
  return structuredClone(result)
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
