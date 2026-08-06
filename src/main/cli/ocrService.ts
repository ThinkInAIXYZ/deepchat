import { open } from 'node:fs/promises'
import {
  OCR_EXTRACTION_MAX_INPUT_BYTES,
  OcrInputMimeTypeSchema,
  OcrExtractionOutputSchema,
  ocrClearCacheRoute,
  ocrExtractArtifactRoute,
  ocrExtractUploadRoute,
  ocrGetRuntimeStatusRoute,
  type OcrExtractArtifactInput,
  type OcrExtractionOutput,
  type OcrExtractUploadInput
} from '@shared/contracts/routes'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION
} from '@shared/contracts/localControl'
import {
  DocumentTextExtractionError,
  type DocumentTextExtractionResult
} from '@/ocr/documentTextExtractionService'
import {
  ImageTextExtractionError,
  type ImageTextExtractionResult
} from '@/ocr/imageTextExtractionService'
import { ImagePreprocessingError, sniffOcrImageMimeType } from '@/ocr/imagePreprocessor'
import {
  OcrRuntimeBusyError,
  type OcrRuntimeService,
  type OcrRuntimeServiceStatus
} from '@/ocr/ocrRuntimeService'
import { toPublicOcrEngine, toPublicOcrStatus } from '@/ocr/routes'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import type { ArtifactSpool } from './artifactSpool'
import { CliRequestError } from './errors'
import type { CliUploadedInputFile } from './server'

const OCR_SIGNATURE_BYTES = 1_024

type CliOcrRuntime = Pick<
  OcrRuntimeService,
  'clearCache' | 'extract' | 'extractDocument' | 'getStatus'
>

export type CliOcrServiceOptions = Readonly<{
  appVersion: string
  ocrRuntime: CliOcrRuntime
  artifactSpool: ArtifactSpool
  now?: () => number
  log?: Pick<Console, 'warn'>
}>

export class CliOcrService {
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly options: CliOcrServiceOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  handlesRpc(method: string): boolean {
    return (
      method === ocrGetRuntimeStatusRoute.name ||
      method === ocrExtractArtifactRoute.name ||
      method === ocrClearCacheRoute.name
    )
  }

  handlesUpload(method: string): boolean {
    return method === ocrExtractUploadRoute.name
  }

  async dispatchRpc(
    method: string,
    rawInput: unknown,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown> {
    switch (method) {
      case ocrExtractArtifactRoute.name:
        return await this.extractArtifact(
          ocrExtractArtifactRoute.input.parse(rawInput),
          caller,
          signal
        )
      case ocrGetRuntimeStatusRoute.name:
        ocrGetRuntimeStatusRoute.input.parse(rawInput)
        signal.throwIfAborted()
        return ocrGetRuntimeStatusRoute.output.parse(
          toPublicOcrStatus(
            await this.options.ocrRuntime.getStatus(),
            process.platform,
            process.arch
          )
        )
      case ocrClearCacheRoute.name: {
        ocrClearCacheRoute.input.parse(rawInput)
        if (caller.principal !== 'human') {
          throw new CliRequestError('permission_denied', 'Agent callers cannot clear OCR cache', {
            httpStatus: 403
          })
        }
        signal.throwIfAborted()
        try {
          await this.options.ocrRuntime.clearCache()
        } catch (error) {
          if (error instanceof OcrRuntimeBusyError) {
            throw new CliRequestError('conflict', error.message, { httpStatus: 409 })
          }
          this.log.warn('[CLI] OCR cache clear failed', {
            failure: { name: error instanceof Error ? error.name : typeof error }
          })
          throw new CliRequestError('unavailable', 'OCR cache could not be cleared', {
            httpStatus: 503,
            retriable: true
          })
        }
        const status = await this.options.ocrRuntime.getStatus()
        if (!status.cache) {
          throw new CliRequestError('internal_error', 'OCR cache status is unavailable', {
            httpStatus: 500
          })
        }
        return ocrClearCacheRoute.output.parse({ cache: status.cache })
      }
      default:
        throw new CliRequestError('not_found', 'OCR method is not implemented', {
          httpStatus: 404
        })
    }
  }

  async dispatchUpload(
    method: string,
    rawInput: unknown,
    upload: CliUploadedInputFile,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown> {
    if (caller.principal !== 'human') {
      throw new CliRequestError('permission_denied', 'Agent callers cannot upload file bytes', {
        httpStatus: 403
      })
    }
    switch (method) {
      case ocrExtractUploadRoute.name:
        return await this.extractUpload(ocrExtractUploadRoute.input.parse(rawInput), upload, signal)
      default:
        throw new CliRequestError('not_found', 'Upload method is not implemented', {
          httpStatus: 404
        })
    }
  }

  private async extractArtifact(
    input: OcrExtractArtifactInput,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<OcrExtractionOutput> {
    return await this.options.artifactSpool.withFile(input.artifactId, caller, async (file) => {
      const mimeType = OcrInputMimeTypeSchema.safeParse(file.metadata.mimeType)
      if (!mimeType.success) {
        throw new CliRequestError('invalid_request', 'Artifact is not a supported OCR input')
      }
      this.assertInputSize(file.metadata.size, 'OCR artifact')
      return await this.extractFile(input, file.path, file.metadata.size, mimeType.data, signal)
    })
  }

  private async extractUpload(
    input: OcrExtractUploadInput,
    upload: CliUploadedInputFile,
    signal: AbortSignal
  ): Promise<OcrExtractionOutput> {
    this.assertInputSize(upload.size, 'OCR upload')
    return await this.extractFile(input, upload.path, upload.size, input.mimeType, signal)
  }

  private async extractFile(
    input: Pick<OcrExtractUploadInput, 'backend' | 'sourcePageCountHint' | 'generationTokenLimit'>,
    filePath: string,
    inputBytes: number,
    declaredMimeType: string,
    signal: AbortSignal
  ): Promise<OcrExtractionOutput> {
    const startedAt = this.now()
    try {
      signal.throwIfAborted()
      const statusBefore = await this.options.ocrRuntime.getStatus()
      if (statusBefore.availability.status === 'unavailable') {
        throw new CliRequestError('unavailable', 'OCR runtime is unavailable', {
          httpStatus: 503,
          details: { reason: statusBefore.availability.reason }
        })
      }
      const kind = await this.inspectOcrInput(filePath, inputBytes, declaredMimeType)
      signal.throwIfAborted()
      if (kind === 'image') {
        if (input.sourcePageCountHint !== undefined || input.generationTokenLimit !== undefined) {
          throw new CliRequestError(
            'invalid_request',
            'PDF-specific OCR options cannot be used with an image'
          )
        }
        const result = await this.options.ocrRuntime.extract({
          filePath,
          maxFileSize: inputBytes,
          backend: input.backend,
          priority: 'background',
          signal
        })
        return this.toImageOutput(result, statusBefore, inputBytes, startedAt)
      }

      const result = await this.options.ocrRuntime.extractDocument({
        filePath,
        maxFileSize: inputBytes,
        backend: input.backend,
        ...(input.sourcePageCountHint !== undefined
          ? { sourcePageCountHint: input.sourcePageCountHint }
          : {}),
        ...(input.generationTokenLimit !== undefined
          ? { generationTokenLimit: input.generationTokenLimit }
          : {}),
        priority: 'background',
        signal
      })
      return this.toDocumentOutput(result, statusBefore, inputBytes, startedAt)
    } catch (error) {
      throw this.normalizeOcrError(error, signal)
    }
  }

  private async inspectOcrInput(
    filePath: string,
    inputBytes: number,
    declaredMimeType: string
  ): Promise<'image' | 'document'> {
    const handle = await open(filePath, 'r')
    try {
      const fileStat = await handle.stat()
      if (!fileStat.isFile() || fileStat.size !== inputBytes) {
        throw new CliRequestError('unavailable', 'OCR input changed before extraction', {
          httpStatus: 410
        })
      }
      const prefix = Buffer.allocUnsafe(Math.min(OCR_SIGNATURE_BYTES, inputBytes))
      const { bytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0)
      const signature = prefix.subarray(0, bytesRead)
      if (declaredMimeType === 'application/pdf') {
        if (signature.indexOf('%PDF-') < 0) {
          throw new CliRequestError('invalid_request', 'OCR input is not a valid PDF file')
        }
        return 'document'
      }

      const detected = sniffOcrImageMimeType(signature)
      if (detected !== declaredMimeType) {
        throw new CliRequestError(
          'invalid_request',
          'OCR image signature does not match its declared MIME type'
        )
      }
      return 'image'
    } finally {
      await handle.close()
    }
  }

  private toImageOutput(
    result: ImageTextExtractionResult,
    statusBefore: OcrRuntimeServiceStatus,
    inputBytes: number,
    startedAt: number
  ): OcrExtractionOutput {
    return OcrExtractionOutputSchema.parse({
      kind: 'image',
      text: result.text,
      tokenCount: result.tokenCount,
      truncated: result.truncated,
      mimeType: result.mimeType,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      strategy: result.strategy,
      engine: toPublicOcrEngine(result.engine),
      cacheHit: result.cacheHit,
      timingMs: result.timingMs,
      benchmark: this.createOcrBenchmark(result.cacheHit, statusBefore, inputBytes, startedAt)
    })
  }

  private toDocumentOutput(
    result: DocumentTextExtractionResult,
    statusBefore: OcrRuntimeServiceStatus,
    inputBytes: number,
    startedAt: number
  ): OcrExtractionOutput {
    return OcrExtractionOutputSchema.parse({
      kind: 'document',
      text: result.text,
      tokenCount: result.tokenCount,
      truncated:
        result.generationOutputLimitReached || result.artifactTermination !== 'request_complete',
      mimeType: 'application/pdf',
      pageSpans: result.pageSpans,
      artifactTermination: result.artifactTermination,
      generationOutputLimitReached: result.generationOutputLimitReached,
      generationTokenLimit: result.generationTokenLimit,
      emittedPages: result.emittedPages,
      ...(result.sourcePageCountHint !== undefined
        ? { sourcePageCountHint: result.sourcePageCountHint }
        : {}),
      ...(result.resourceLimit
        ? {
            resourceLimit: {
              code: result.resourceLimit.code,
              message: 'OCR document processing reached a resource limit'
            }
          }
        : {}),
      engine: toPublicOcrEngine(result.engine),
      cacheHit: result.cacheHit,
      timingMs: result.timingMs,
      benchmark: this.createOcrBenchmark(result.cacheHit, statusBefore, inputBytes, startedAt)
    })
  }

  private createOcrBenchmark(
    cacheHit: boolean,
    statusBefore: OcrRuntimeServiceStatus,
    inputBytes: number,
    startedAt: number
  ) {
    const stateBefore = statusBefore.process?.state
    return {
      state: cacheHit
        ? ('hit' as const)
        : stateBefore === 'ready' || stateBefore === 'busy'
          ? ('miss-warm' as const)
          : ('cold-runtime' as const),
      runtimeStateBefore: stateBefore ?? ('not-started' as const),
      runtimeWasReady: stateBefore === 'ready',
      inputBytes,
      durationMs: Math.max(0, this.now() - startedAt),
      appVersion: this.options.appVersion,
      protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
      surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
    }
  }

  private assertInputSize(size: number, name: string): void {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new CliRequestError('invalid_request', `${name} is empty or invalid`)
    }
    if (size > OCR_EXTRACTION_MAX_INPUT_BYTES) {
      throw new CliRequestError('body_too_large', `${name} exceeds its byte limit`, {
        httpStatus: 413
      })
    }
  }

  private normalizeOcrError(error: unknown, signal: AbortSignal): CliRequestError {
    if (error instanceof CliRequestError) return error
    if (
      signal.aborted ||
      (error instanceof ImagePreprocessingError && error.code === 'cancelled') ||
      (error instanceof ImageTextExtractionError && error.code === 'cancelled') ||
      (error instanceof DocumentTextExtractionError && error.code === 'cancelled')
    ) {
      return new CliRequestError('cancelled', 'OCR extraction was cancelled', { retriable: true })
    }
    if (
      (error instanceof ImageTextExtractionError && error.code === 'queue_full') ||
      (error instanceof DocumentTextExtractionError && error.code === 'queue_full')
    ) {
      return new CliRequestError('rate_limited', 'OCR extraction capacity is full', {
        httpStatus: 429,
        retriable: true
      })
    }
    if (
      error instanceof ImagePreprocessingError ||
      (error instanceof DocumentTextExtractionError &&
        ['empty_input', 'input_too_large', 'invalid_input'].includes(error.code))
    ) {
      return new CliRequestError('invalid_request', 'OCR input is invalid or unsupported')
    }
    this.log.warn('[CLI] OCR extraction failed', {
      failure: { name: error instanceof Error ? error.name : typeof error }
    })
    return new CliRequestError('unavailable', 'OCR extraction failed', {
      httpStatus: 503,
      retriable: true
    })
  }
}
