import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS,
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  PDF_PAGE_COUNT_SANITY_LIMIT
} from '../../types/attachment'
import { ArtifactIdSchema } from './artifacts.routes'

export const OCR_EXTRACTION_MAX_INPUT_BYTES = 50 * 1024 * 1024

export const OcrBackendSchema = z.enum(['auto', 'cpu'])
export const OcrRecognitionStrategySchema = z.enum(['bounded-960', 'tiled-v1'])
export const OcrRuntimeUnavailableReasonSchema = z.enum([
  'asset_identity_mismatch',
  'assets_missing',
  'runtime_manifest_invalid',
  'service_closed',
  'unsupported_platform'
])

const OcrAvailabilitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    lightOcrVersion: z.string(),
    bundleId: z.string()
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: OcrRuntimeUnavailableReasonSchema,
    lightOcrVersion: z.string(),
    bundleId: z.string()
  })
])

const OcrEngineStageSchema = z
  .object({
    providerChain: z.array(z.string().min(1).max(256)).max(16),
    precision: z.string().min(1).max(128)
  })
  .strict()

export const OcrEngineSchema = z
  .object({
    coreVersion: z.string().min(1).max(128),
    modelBundleId: z.string().min(1).max(256),
    requestedBackend: OcrBackendSchema,
    strategy: OcrRecognitionStrategySchema,
    detection: OcrEngineStageSchema,
    recognition: OcrEngineStageSchema
  })
  .strict()

const OcrProcessSchema = z.object({
  state: z.enum(['idle', 'starting', 'ready', 'busy', 'stopping', 'closed']),
  nodeVersion: z.string().nullable(),
  queuedRequests: z.number().int().nonnegative(),
  pendingInputBytes: z.number().int().nonnegative(),
  engine: OcrEngineSchema.nullable()
})

const OcrCacheSchema = z.object({
  mode: z.enum(['memory', 'persistent']),
  persistenceUnavailableReason: z.enum(['database_error', 'safe_storage_unavailable']).optional(),
  entryCount: z.number().int().nonnegative(),
  logicalBytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive()
})

export const OcrRuntimeStatusSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  availability: OcrAvailabilitySchema,
  process: OcrProcessSchema.nullable(),
  cache: OcrCacheSchema.nullable()
})

export const ocrGetRuntimeStatusRoute = defineRouteContract({
  name: 'ocr.getRuntimeStatus',
  input: z.object({}).default({}),
  output: OcrRuntimeStatusSchema
})

export const ocrClearCacheRoute = defineRouteContract({
  name: 'ocr.clearCache',
  input: z.object({}).default({}),
  output: z.object({
    cache: OcrCacheSchema
  })
})

export const OcrInputMimeTypeSchema = z.enum([
  'application/pdf',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp'
])

const OcrExtractionOptionsSchema = z
  .object({
    backend: OcrBackendSchema.default('auto'),
    sourcePageCountHint: z.number().int().positive().max(PDF_PAGE_COUNT_SANITY_LIMIT).optional(),
    generationTokenLimit: z.number().int().positive().max(ATTACHMENT_PDF_OCR_MAX_TOKENS).optional()
  })
  .strict()

export const OcrExtractUploadInputSchema = OcrExtractionOptionsSchema.extend({
  mimeType: OcrInputMimeTypeSchema
}).strict()

export const OcrExtractArtifactInputSchema = OcrExtractionOptionsSchema.extend({
  artifactId: ArtifactIdSchema
}).strict()

const OcrPublicTimingSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(24 * 60 * 60_000)

export const OcrBenchmarkSchema = z
  .object({
    state: z.enum(['hit', 'miss-warm', 'cold-runtime']),
    runtimeStateBefore: z.enum([
      'not-started',
      'idle',
      'starting',
      'ready',
      'busy',
      'stopping',
      'closed'
    ]),
    runtimeWasReady: z.boolean(),
    inputBytes: z.number().int().positive().max(OCR_EXTRACTION_MAX_INPUT_BYTES),
    durationMs: OcrPublicTimingSchema,
    appVersion: z.string().min(1).max(128),
    protocolVersion: z.literal(1),
    surfaceVersion: z.literal(1)
  })
  .strict()
  .superRefine((benchmark, context) => {
    if (benchmark.runtimeWasReady !== (benchmark.runtimeStateBefore === 'ready')) {
      context.addIssue({
        code: 'custom',
        message: 'OCR runtime readiness does not match its pre-extraction state',
        path: ['runtimeWasReady']
      })
    }
    const warmRuntime =
      benchmark.runtimeStateBefore === 'ready' || benchmark.runtimeStateBefore === 'busy'
    if (
      (benchmark.state === 'miss-warm' && !warmRuntime) ||
      (benchmark.state === 'cold-runtime' && warmRuntime)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OCR benchmark classification does not match its pre-extraction state',
        path: ['state']
      })
    }
  })

const OcrExtractionCommonSchema = z.object({
  text: z.string().max(ATTACHMENT_OCR_MAX_TEXT_CHARACTERS),
  tokenCount: z.number().int().nonnegative().max(ATTACHMENT_PDF_OCR_MAX_TOKENS),
  truncated: z.boolean(),
  engine: OcrEngineSchema,
  cacheHit: z.boolean(),
  benchmark: OcrBenchmarkSchema
})

const OcrImageExtractionOutputSchema = OcrExtractionCommonSchema.extend({
  kind: z.literal('image'),
  mimeType: OcrInputMimeTypeSchema.exclude(['application/pdf']),
  imageWidth: z.number().int().positive().max(16_384),
  imageHeight: z.number().int().positive().max(16_384),
  strategy: OcrRecognitionStrategySchema,
  timingMs: z
    .object({
      snapshot: OcrPublicTimingSchema,
      preprocessing: OcrPublicTimingSchema,
      recognition: OcrPublicTimingSchema,
      total: OcrPublicTimingSchema
    })
    .strict()
}).strict()

const OcrDocumentPageSpanSchema = z
  .object({
    pageNumber: z.number().int().positive().max(PDF_PAGE_COUNT_SANITY_LIMIT),
    start: z.number().int().nonnegative().max(ATTACHMENT_OCR_MAX_TEXT_CHARACTERS),
    end: z.number().int().nonnegative().max(ATTACHMENT_OCR_MAX_TEXT_CHARACTERS),
    complete: z.boolean()
  })
  .strict()

const OcrDocumentExtractionOutputSchema = OcrExtractionCommonSchema.extend({
  kind: z.literal('document'),
  mimeType: z.literal('application/pdf'),
  pageSpans: z.array(OcrDocumentPageSpanSchema).max(ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS),
  artifactTermination: z.enum(['request_complete', 'stopped_by_output_limit', 'resource_limited']),
  generationOutputLimitReached: z.boolean(),
  generationTokenLimit: z.number().int().positive().max(ATTACHMENT_PDF_OCR_MAX_TOKENS),
  emittedPages: z.number().int().nonnegative().max(ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS),
  sourcePageCountHint: z.number().int().positive().max(PDF_PAGE_COUNT_SANITY_LIMIT).optional(),
  resourceLimit: z
    .object({
      code: z.literal('resource_limit_exceeded'),
      message: z.string().max(2_048)
    })
    .strict()
    .optional(),
  timingMs: z
    .object({
      snapshot: OcrPublicTimingSchema,
      recognition: OcrPublicTimingSchema,
      total: OcrPublicTimingSchema
    })
    .strict()
}).strict()

export const OcrExtractionOutputSchema = z
  .discriminatedUnion('kind', [OcrImageExtractionOutputSchema, OcrDocumentExtractionOutputSchema])
  .superRefine((output, context) => {
    if (output.cacheHit !== (output.benchmark.state === 'hit')) {
      context.addIssue({
        code: 'custom',
        message: 'OCR cache result does not match its benchmark classification',
        path: ['benchmark', 'state']
      })
    }
  })

export const ocrExtractUploadRoute = defineRouteContract({
  name: 'ocr.extractUpload',
  input: OcrExtractUploadInputSchema,
  output: OcrExtractionOutputSchema
})

export const ocrExtractArtifactRoute = defineRouteContract({
  name: 'ocr.extractArtifact',
  input: OcrExtractArtifactInputSchema,
  output: OcrExtractionOutputSchema
})

export type OcrRuntimeStatus = z.infer<typeof OcrRuntimeStatusSchema>
export type OcrEngine = z.infer<typeof OcrEngineSchema>
export type OcrExtractUploadInput = z.infer<typeof OcrExtractUploadInputSchema>
export type OcrExtractArtifactInput = z.infer<typeof OcrExtractArtifactInputSchema>
export type OcrExtractionOutput = z.infer<typeof OcrExtractionOutputSchema>
