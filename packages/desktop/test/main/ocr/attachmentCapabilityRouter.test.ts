import { describe, expect, it, vi } from 'vitest'

import {
  AttachmentCapabilityRouter,
  applyTurnOcrTextBudget,
  type AttachmentOcrRuntimePort
} from '@/ocr/attachmentCapabilityRouter'
import { ImagePreprocessingError } from '@/ocr/imagePreprocessor'
import { ImageTextExtractionError } from '@/ocr/imageTextExtractionService'
import { LightOcrProcessHostError } from '@/ocr/lightOcrProcessHost'
import {
  DocumentTextExtractionError,
  type DocumentTextExtractionResult
} from '@/ocr/documentTextExtractionService'
import type { MessageFile, SendMessageInput } from '@shared/types/agent-interface'
import type { PdfEmbeddedTextCoverage } from '@shared/types/attachment'

const AVAILABLE = {
  status: 'available' as const,
  assets: {
    nodeExecutable: '/runtime/node',
    helperEntryPath: '/runtime/helper.js',
    facadeDir: '/runtime/facade',
    runtimeDir: '/runtime/runtime',
    bundlePath: '/runtime/bundle',
    nativePackageDir: '/runtime/native',
    nativePayloadEncoding: 'gzip-base64-v1' as const,
    nativePackage: '@arcships/light-ocr-native-test',
    lightOcrVersion: '0.5.5',
    bundleId: 'bundle-v1'
  }
}

const extractionResult = (text = 'recognized text') => ({
  text,
  tokenCount: text ? 3 : 0,
  truncated: false,
  mimeType: 'image/png',
  imageWidth: 100,
  imageHeight: 50,
  strategy: 'bounded-960' as const,
  engine: {
    modelBundleId: 'bundle-v1',
    requestedProvider: 'auto' as const,
    strategy: 'bounded-960' as const,
    detection: {
      actualProviderChain: ['coreml'],
      precision: 'fp16',
      qualificationId: 'detection-v1'
    },
    recognition: {
      actualProviderChain: ['cpu'],
      precision: 'fp32',
      qualificationId: 'recognition-v1'
    }
  },
  cacheHit: false,
  timingMs: { snapshot: 1, preprocessing: 2, recognition: 3, total: 6 }
})

const documentExtractionResult = (
  overrides: Partial<DocumentTextExtractionResult> = {}
): DocumentTextExtractionResult => {
  const text = overrides.text ?? '## Page 1\n\nrecognized PDF text'
  return {
    text,
    tokenCount: overrides.tokenCount ?? 7,
    pageSpans: overrides.pageSpans ?? [
      { pageNumber: 1, start: 0, end: text.length, complete: true }
    ],
    artifactTermination: 'request_complete',
    generationOutputLimitReached: false,
    generationTokenLimit: 16_000,
    emittedPages: 1,
    sourcePageCountHint: 1,
    engine: {
      modelBundleId: 'bundle-v1',
      requestedProvider: 'auto',
      strategy: 'bounded-960',
      detection: {
        actualProviderChain: ['coreml'],
        precision: 'fp16',
        qualificationId: 'detection-v1'
      },
      recognition: {
        actualProviderChain: ['cpu'],
        precision: 'fp32',
        qualificationId: 'recognition-v1'
      }
    },
    cacheHit: false,
    timingMs: { snapshot: 1, recognition: 4, total: 5 },
    ...overrides
  }
}

function image(index = 1, overrides: Partial<MessageFile> = {}): MessageFile {
  return {
    name: `image-${index}.png`,
    path: `/tmp/image-${index}.png`,
    mimeType: 'image/png',
    content: 'data:image/png;base64,AA==',
    ...overrides
  }
}

function pdfCoverage(
  pageCount: number,
  substantivePageCount: number,
  overrides: Partial<PdfEmbeddedTextCoverage> = {}
): PdfEmbeddedTextCoverage {
  const lowTextPageCount = pageCount - substantivePageCount
  return {
    routingRevision: 'pdf-text-coverage-v1',
    pageCount,
    substantivePageCount,
    lowTextPageCount,
    lowTextPageSamples: Array.from(
      { length: Math.min(20, lowTextPageCount) },
      (_, index) => substantivePageCount + index + 1
    ),
    hasEmbeddedText: substantivePageCount > 0,
    ...overrides
  }
}

function pdf(index = 1, overrides: Partial<MessageFile> = {}): MessageFile {
  return {
    name: `document-${index}.pdf`,
    path: `/tmp/document-${index}.pdf`,
    mimeType: 'application/pdf',
    content: '# PDF content\n\nembedded text',
    pdfTextCoverage: pdfCoverage(10, 9),
    ...overrides
  }
}

function createExtraction(
  overrides: Partial<AttachmentOcrRuntimePort> = {}
): AttachmentOcrRuntimePort {
  return {
    getAvailability: vi.fn(async () => AVAILABLE),
    extract: vi.fn(async () => extractionResult()),
    extractBatch: vi.fn(async (inputs) =>
      inputs.map(() => ({ status: 'fulfilled' as const, value: extractionResult() }))
    ),
    extractDocument: vi.fn(async () => documentExtractionResult()),
    ...overrides
  }
}

function createRouter(input?: {
  extraction?: AttachmentOcrRuntimePort
  automaticOcrEnabled?: boolean
  onDiagnostic?: ConstructorParameters<typeof AttachmentCapabilityRouter>[0]['onDiagnostic']
}) {
  const extraction = input?.extraction ?? createExtraction()
  return {
    extraction,
    router: new AttachmentCapabilityRouter({
      extraction,
      getAutomaticOcrEnabled: () => input?.automaticOcrEnabled ?? true,
      getBackendPreference: () => 'auto',
      getMaxFileSize: () => 30 * 1024 * 1024,
      onDiagnostic: input?.onDiagnostic
    })
  }
}

async function prepare(
  router: AttachmentCapabilityRouter,
  content: SendMessageInput,
  supportsVision = false,
  reusePreparedAttachmentRepresentations = false,
  preserveResolvedRepresentations = false
) {
  return await router.prepare({
    content,
    supportsVision,
    reusePreparedAttachmentRepresentations,
    preserveResolvedRepresentations
  })
}

describe('AttachmentCapabilityRouter', () => {
  it('keeps Auto images on the vision path without starting OCR', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(router, { text: '', files: [image()] }, true)

    expect(result.summary).toEqual({ status: 'ready', issues: [], suggestedActions: [] })
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({ kind: 'image' })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('can suppress acceptance diagnostics until the dispatch-time routing pass', async () => {
    const onDiagnostic = vi.fn()
    const { router } = createRouter({ onDiagnostic })

    const result = await router.prepare({
      content: { text: '', files: [image()] },
      supportsVision: false,
      emitDiagnostics: false
    })

    expect(result.summary.status).toBe('ready')
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('forces OCR Text even when the selected model supports vision', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      { text: '', files: [image(1, { requestedRepresentation: 'ocr_text' })] },
      true
    )

    expect(result.summary.status).toBe('ready')
    expect(result.content.files?.[0].resolvedRepresentation).toMatchObject({
      kind: 'ocr_text',
      text: 'recognized text'
    })
    expect(extraction.extractBatch).toHaveBeenCalledOnce()
  })

  it('blocks a pure image when automatic OCR is disabled', async () => {
    const { router } = createRouter({ automaticOcrEnabled: false })
    const result = await prepare(router, { text: '', files: [image()] })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'automatic_ocr_disabled' }],
      suggestedActions: ['switch_to_vision_model', 'send_without_image_content']
    })
  })

  it('continues as degraded when a failed image has a user caption', async () => {
    const extraction = createExtraction({
      extractBatch: vi.fn(async () => [
        {
          status: 'rejected',
          reason: new ImagePreprocessingError('unsupported_format', 'unsupported')
        }
      ])
    })
    const { router } = createRouter({ extraction })
    const result = await prepare(router, { text: 'Please inspect this.', files: [image()] })

    expect(result.summary.status).toBe('degraded')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'unsupported_image_format'
    })
  })

  it('allows an explicit metadata-only fallback without pretending the image was sent', async () => {
    const { router, extraction } = createRouter({ automaticOcrEnabled: false })
    const result = await prepare(router, {
      text: '',
      files: [image()],
      attachmentFallbackPolicy: 'send_without_image_content'
    })

    expect(result.summary.status).toBe('degraded')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'user_skipped_image_content'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('never sends an image after the user selects the metadata-only fallback', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      {
        text: '',
        files: [image()],
        attachmentFallbackPolicy: 'send_without_image_content'
      },
      true
    )

    expect(result.summary.status).toBe('degraded')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'user_skipped_image_content'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('blocks a vision-path image when no provider-ready payload exists', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      { text: '', files: [image(1, { content: '', thumbnail: '' })] },
      true
    )

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'image_payload_unavailable' }],
      suggestedActions: ['send_without_image_content']
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('does not treat an empty image data URL as provider-ready content', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      { text: '', files: [image(1, { content: 'data:image/png;base64,', thumbnail: '' })] },
      true
    )

    expect(result.summary.status).toBe('needs_user_action')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'image_payload_unavailable'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('does not treat whitespace or malformed base64 as provider-ready image content', async () => {
    const { router, extraction } = createRouter()

    for (const content of ['data:image/png;base64,   \n  ', 'data:image/png;base64,not@base64']) {
      const result = await prepare(
        router,
        { text: '', files: [image(1, { content, thumbnail: '' })] },
        true
      )
      expect(result.summary.status).toBe('needs_user_action')
      expect(result.content.files?.[0].resolvedRepresentation).toEqual({
        kind: 'unavailable',
        reason: 'image_payload_unavailable'
      })
    }
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('falls back to a valid thumbnail when the preferred image payload is malformed', async () => {
    const { router, extraction } = createRouter()
    const thumbnail = 'data:image/jpeg;base64,AA=='

    const result = await prepare(
      router,
      {
        text: '',
        files: [image(1, { content: 'data:image/png;base64,invalid@', thumbnail })]
      },
      true
    )

    expect(result.summary.status).toBe('ready')
    expect(result.content.files?.[0]).toMatchObject({
      content: undefined,
      thumbnail,
      resolvedRepresentation: { kind: 'image' }
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('canonicalizes whitespace in a valid provider image payload', async () => {
    const { router } = createRouter()

    const result = await prepare(
      router,
      { text: '', files: [image(1, { content: 'data:image/png;base64,AA\n==' })] },
      true
    )

    expect(result.content.files?.[0].content).toBe('data:image/png;base64,AA==')
  })

  it('reports unavailable offline assets without calling extraction', async () => {
    const extraction = createExtraction({
      getAvailability: vi.fn(async () => ({
        status: 'unavailable',
        reason: 'unsupported_platform',
        lightOcrVersion: '0.5.5',
        bundleId: 'bundle-v1'
      }))
    })
    const { router } = createRouter({ extraction })
    const result = await prepare(router, { text: '', files: [image()] })

    expect(result.summary.issues).toEqual([
      { attachmentIndex: 0, reason: 'ocr_runtime_unavailable' }
    ])
    expect(extraction.extractBatch).not.toHaveBeenCalled()
  })

  it('reuses a trusted sent OCR snapshot without reading the source path again', async () => {
    const diagnostics: Array<
      Parameters<
        NonNullable<ConstructorParameters<typeof AttachmentCapabilityRouter>[0]['onDiagnostic']>
      >[0]
    > = []
    const { router, extraction } = createRouter({
      onDiagnostic: (event) => diagnostics.push(event)
    })
    const result = await prepare(
      router,
      {
        text: '',
        files: [
          image(1, {
            resolvedRepresentation: {
              kind: 'ocr_text',
              text: 'persisted snapshot',
              tokenCount: 4,
              truncated: false
            }
          })
        ]
      },
      false,
      true
    )

    expect(result.content.files?.[0].resolvedRepresentation).toMatchObject({
      kind: 'ocr_text',
      text: 'persisted snapshot'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
    expect(diagnostics).toEqual([
      expect.objectContaining({ representation: 'ocr_text', snapshotReused: true })
    ])
    expect(diagnostics[0]).not.toHaveProperty('cacheHit')
  })

  it('preserves a sent image snapshot on retry instead of silently converting it to OCR', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      {
        text: '',
        files: [image(1, { resolvedRepresentation: { kind: 'image' } })]
      },
      false,
      false,
      true
    )

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'requested_image_requires_vision' }],
      suggestedActions: ['switch_to_vision_model', 'send_without_image_content']
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
    expect(extraction.extractBatch).not.toHaveBeenCalled()
  })

  it('preserves an unavailable sent snapshot on retry without rerunning OCR', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      {
        text: 'Keep the original degraded turn.',
        files: [
          image(1, {
            resolvedRepresentation: { kind: 'unavailable', reason: 'ocr_empty' }
          })
        ]
      },
      false,
      false,
      true
    )

    expect(result.summary.status).toBe('degraded')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'ocr_empty'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
    expect(extraction.extractBatch).not.toHaveBeenCalled()
  })

  it('does not trust a caller-provided resolved snapshot by default', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(router, {
      text: '',
      files: [
        image(1, {
          resolvedRepresentation: {
            kind: 'ocr_text',
            text: 'spoofed',
            tokenCount: 1,
            truncated: false
          }
        })
      ]
    })

    expect(result.content.files?.[0].resolvedRepresentation).toMatchObject({
      kind: 'ocr_text',
      text: 'recognized text'
    })
    expect(extraction.extractBatch).toHaveBeenCalledOnce()
  })

  it('uses embedded PDF text at the 90 percent Auto coverage boundary', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(router, { text: '', files: [pdf()] })

    expect(result.summary).toEqual({ status: 'ready', issues: [], suggestedActions: [] })
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'embedded_text'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
    expect(extraction.extractDocument).not.toHaveBeenCalled()
  })

  it('normalizes image-only and PDF-only representation choices back to Auto', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(
      router,
      {
        text: '',
        files: [
          image(1, { requestedRepresentation: 'embedded_text' }),
          pdf(1, { requestedRepresentation: 'image' })
        ]
      },
      true
    )

    expect(result.content.files?.[0]).toMatchObject({
      requestedRepresentation: 'auto',
      resolvedRepresentation: { kind: 'image' }
    })
    expect(result.content.files?.[1]).toMatchObject({
      requestedRepresentation: 'auto',
      resolvedRepresentation: { kind: 'embedded_text' }
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('uses PDF OCR below the 90 percent Auto coverage boundary', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(100, 89) })]
    })

    expect(result.content.files?.[0].resolvedRepresentation).toMatchObject({
      kind: 'ocr_text',
      text: '## Page 1\n\nrecognized PDF text',
      document: {
        sourcePageCountHint: 1,
        includedThroughPage: 1,
        artifactTermination: 'request_complete'
      }
    })
    expect(extraction.extractDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/document-1.pdf',
        sourcePageCountHint: 100,
        generationTokenLimit: 16_000
      })
    )
  })

  it('treats missing or stale PDF coverage as requiring Auto OCR', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(router, {
      text: '',
      files: [
        pdf(1, { pdfTextCoverage: undefined }),
        pdf(2, {
          pdfTextCoverage: pdfCoverage(10, 10, { routingRevision: 'stale-routing-rule' })
        })
      ]
    })

    expect(extraction.extractDocument).toHaveBeenCalledOnce()
    expect(result.content.files?.[0].resolvedRepresentation?.kind).toBe('ocr_text')
    expect(result.content.files?.[1].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'document_limit_exceeded'
    })
  })

  it('allows explicit embedded text for a short PDF but rejects an empty body', async () => {
    const { router, extraction } = createRouter()
    const shortCoverage = pdfCoverage(1, 0, {
      lowTextPageSamples: [1],
      hasEmbeddedText: true
    })

    const result = await prepare(router, {
      text: '',
      files: [
        pdf(1, {
          content: 'Short note',
          pdfTextCoverage: shortCoverage,
          requestedRepresentation: 'embedded_text'
        }),
        pdf(2, {
          content: '',
          pdfTextCoverage: shortCoverage,
          requestedRepresentation: 'embedded_text'
        })
      ]
    })

    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'embedded_text'
    })
    expect(result.content.files?.[1].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'pdf_text_unavailable'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('honors explicit PDF OCR when automatic OCR is disabled', async () => {
    const { router, extraction } = createRouter({ automaticOcrEnabled: false })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { requestedRepresentation: 'ocr_text' })]
    })

    expect(result.summary.status).toBe('ready')
    expect(result.content.files?.[0].resolvedRepresentation?.kind).toBe('ocr_text')
    expect(extraction.extractDocument).toHaveBeenCalledOnce()
  })

  it('blocks Auto PDF OCR when automatic OCR is disabled', async () => {
    const { router, extraction } = createRouter({ automaticOcrEnabled: false })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
    })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'automatic_ocr_disabled' }],
      suggestedActions: ['send_without_image_content']
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('keeps the legacy fallback action but records a document-neutral skipped reason', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(router, {
      text: '',
      files: [pdf()],
      attachmentFallbackPolicy: 'send_without_image_content'
    })

    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'user_skipped_attachment_content'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('limits PDF OCR independently from the eight-image allowance', async () => {
    const { router, extraction } = createRouter()
    const files = [
      ...Array.from({ length: 8 }, (_, index) =>
        image(index + 1, { requestedRepresentation: 'ocr_text' })
      ),
      pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) }),
      pdf(2, { pdfTextCoverage: pdfCoverage(10, 0) })
    ]

    const result = await prepare(router, { text: '', files })

    expect(vi.mocked(extraction.extractBatch).mock.calls[0][0]).toHaveLength(8)
    expect(extraction.extractDocument).toHaveBeenCalledOnce()
    expect(extraction.getAvailability).toHaveBeenCalledOnce()
    expect(result.content.files?.[8].resolvedRepresentation?.kind).toBe('ocr_text')
    expect(result.content.files?.[9].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'document_limit_exceeded'
    })
  })

  it('keeps useful resource-limited PDF text as a non-retryable degraded result', async () => {
    const extraction = createExtraction({
      extractDocument: vi.fn(async () =>
        documentExtractionResult({
          artifactTermination: 'resource_limited',
          resourceLimit: {
            code: 'resource_limit_exceeded',
            message: 'Rendered pixel budget exceeded'
          }
        })
      )
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
    })

    expect(result.summary).toEqual({
      status: 'degraded',
      issues: [{ attachmentIndex: 0, reason: 'ocr_resource_limited' }],
      suggestedActions: []
    })
    expect(result.content.files?.[0].resolvedRepresentation).toMatchObject({
      kind: 'ocr_text',
      truncated: true,
      document: {
        artifactTermination: 'resource_limited',
        generationOutputLimitReached: false,
        includedThroughPage: 1
      }
    })
  })

  it('maps a zero-page PDF resource limit without offering a deterministic retry', async () => {
    const extraction = createExtraction({
      extractDocument: vi.fn(async () => {
        throw new LightOcrProcessHostError('helper_error', 'page too large', {
          helperCode: 'resource_limit_exceeded'
        })
      })
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
    })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_resource_limited' }],
      suggestedActions: ['send_without_image_content']
    })
  })

  it('keeps a cached resource-limited empty prefix distinct from a completed empty OCR', async () => {
    const extraction = createExtraction({
      extractDocument: vi.fn(async () =>
        documentExtractionResult({
          text: '',
          tokenCount: 0,
          pageSpans: [{ pageNumber: 1, start: 0, end: 0, complete: true }],
          artifactTermination: 'resource_limited',
          resourceLimit: {
            code: 'resource_limit_exceeded',
            message: 'Rendered pixel budget exceeded'
          }
        })
      )
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
    })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_resource_limited' }],
      suggestedActions: ['send_without_image_content']
    })
  })

  it('does not offer retry for a cached empty PDF OCR result', async () => {
    const extraction = createExtraction({
      extractDocument: vi.fn(async () =>
        documentExtractionResult({
          text: '',
          tokenCount: 0,
          pageSpans: [],
          emittedPages: 0
        })
      )
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, {
      text: '',
      files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
    })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
      suggestedActions: ['send_without_image_content']
    })
  })

  it('does not offer a no-op retry for empty image OCR either', async () => {
    const extraction = createExtraction({
      extractBatch: vi.fn(async () => [
        { status: 'fulfilled' as const, value: extractionResult('') }
      ])
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, { text: '', files: [image()] })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
      suggestedActions: ['switch_to_vision_model', 'send_without_image_content']
    })
  })

  it('reuses a legacy PDF body on retry without opening the source', async () => {
    const { router, extraction } = createRouter()

    const result = await prepare(
      router,
      {
        text: '',
        files: [pdf(1, { pdfTextCoverage: undefined, resolvedRepresentation: undefined })]
      },
      false,
      false,
      true
    )

    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'embedded_text'
    })
    expect(extraction.getAvailability).not.toHaveBeenCalled()
    expect(extraction.extractDocument).not.toHaveBeenCalled()
  })

  it('uses page-aware prefix truncation when packing persisted PDF OCR snapshots', async () => {
    const firstPage = `## Page 1\n\n${'alpha '.repeat(7_500)}`
    const secondPage = `\n\n## Page 2\n\n${'omega '.repeat(7_500)}TAIL_SECRET`
    const text = firstPage + secondPage
    const resolvedRepresentation = {
      kind: 'ocr_text' as const,
      text,
      tokenCount: 16_000,
      truncated: false,
      document: {
        pageSpans: [
          { pageNumber: 1, start: 0, end: firstPage.length, complete: true },
          {
            pageNumber: 2,
            start: firstPage.length,
            end: text.length,
            complete: true
          }
        ],
        sourcePageCountHint: 2,
        includedThroughPage: 2,
        includedThroughPageComplete: true,
        artifactTermination: 'request_complete' as const,
        generationOutputLimitReached: false
      }
    }
    const { router, extraction } = createRouter()

    const result = await prepare(
      router,
      {
        text: '',
        files: [pdf(1, { resolvedRepresentation }), pdf(2, { resolvedRepresentation })]
      },
      false,
      false,
      true
    )

    const representations = result.content.files?.map((file) => file.resolvedRepresentation)
    expect(
      representations?.reduce(
        (total, value) => total + (value?.kind === 'ocr_text' ? value.tokenCount : 0),
        0
      )
    ).toBeLessThanOrEqual(16_000)
    for (const representation of representations ?? []) {
      expect(representation).toMatchObject({
        kind: 'ocr_text',
        truncated: true,
        document: {
          generationOutputLimitReached: true,
          includedThroughPageComplete: false
        }
      })
      if (representation?.kind === 'ocr_text') {
        expect(representation.text).toContain('[… PDF OCR truncated …]')
        expect(representation.text).not.toContain('TAIL_SECRET')
      }
    }
    expect(resolvedRepresentation.document.generationOutputLimitReached).toBe(false)
    expect(resolvedRepresentation.text).toContain('TAIL_SECRET')
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('reports turn budget exhaustion without misclassifying recognized PDF text as empty', () => {
    const text = '## Page 1\n\nrecognized PDF text'
    const files = [
      pdf(1, {
        resolvedRepresentation: {
          kind: 'ocr_text',
          text,
          tokenCount: 7,
          truncated: false,
          document: {
            pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
            sourcePageCountHint: 1,
            includedThroughPage: 1,
            includedThroughPageComplete: true,
            artifactTermination: 'request_complete',
            generationOutputLimitReached: false
          }
        }
      })
    ]
    const issues = [{ attachmentIndex: 0, reason: 'ocr_resource_limited' as const }]

    applyTurnOcrTextBudget(files, issues, 1)

    expect(files[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'turn_ocr_budget_exhausted'
    })
    expect(issues).toEqual([{ attachmentIndex: 0, reason: 'turn_ocr_budget_exhausted' }])
  })

  it('bounds OCR work to eight images and degrades when some images are skipped', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(router, {
      text: '',
      files: Array.from({ length: 10 }, (_, index) => image(index + 1))
    })

    expect(extraction.extractBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ filePath: '/tmp/image-1.png' })])
    )
    expect(vi.mocked(extraction.extractBatch).mock.calls[0][0]).toHaveLength(8)
    expect(result.summary.status).toBe('degraded')
    expect(result.summary.issues).toEqual([
      { attachmentIndex: 8, reason: 'image_limit_exceeded' },
      { attachmentIndex: 9, reason: 'image_limit_exceeded' }
    ])
  })

  it('keeps more than eight vision-routed images available without starting OCR', async () => {
    const { router, extraction } = createRouter()
    const result = await prepare(
      router,
      { text: '', files: Array.from({ length: 10 }, (_, index) => image(index + 1)) },
      true
    )

    expect(result.summary).toEqual({ status: 'ready', issues: [], suggestedActions: [] })
    expect(
      result.content.files?.every((file) => file.resolvedRepresentation?.kind === 'image')
    ).toBe(true)
    expect(extraction.getAvailability).not.toHaveBeenCalled()
  })

  it('counts only OCR candidates when enforcing the eight-image OCR limit', async () => {
    const { router, extraction } = createRouter()
    const files = Array.from({ length: 18 }, (_, index) =>
      image(index + 1, {
        requestedRepresentation: index % 2 === 0 ? 'image' : 'ocr_text'
      })
    )

    const result = await prepare(router, { text: '', files }, true)

    expect(vi.mocked(extraction.extractBatch).mock.calls[0][0]).toHaveLength(8)
    expect(result.summary).toEqual({
      status: 'degraded',
      issues: [{ attachmentIndex: 17, reason: 'image_limit_exceeded' }],
      suggestedActions: []
    })
    expect(
      result.content.files
        ?.filter((_, index) => index % 2 === 0)
        .every((file) => file.resolvedRepresentation?.kind === 'image')
    ).toBe(true)
    expect(
      result.content.files
        ?.slice(0, 17)
        .filter((_, index) => index % 2 === 1)
        .every((file) => file.resolvedRepresentation?.kind === 'ocr_text')
    ).toBe(true)
    expect(result.content.files?.[17].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'image_limit_exceeded'
    })
  })

  it('reapplies the per-turn OCR token budget to merged prepared snapshots', async () => {
    const diagnostics: Array<{ attachmentIndex: number; tokenCount?: number }> = []
    const { router, extraction } = createRouter({
      onDiagnostic: (event) => diagnostics.push(event)
    })
    const longText = 'recognized content '.repeat(2_000)
    const result = await prepare(
      router,
      {
        text: '',
        files: Array.from({ length: 8 }, (_, index) =>
          image(index + 1, {
            resolvedRepresentation: {
              kind: 'ocr_text',
              text: longText,
              tokenCount: 6_000,
              truncated: false
            }
          })
        )
      },
      false,
      true
    )

    const representations = result.content.files?.map((file) => file.resolvedRepresentation)
    const totalTokens =
      representations?.reduce(
        (total, representation) =>
          total + (representation?.kind === 'ocr_text' ? representation.tokenCount : 0),
        0
      ) ?? 0
    expect(totalTokens).toBeLessThanOrEqual(16_000)
    expect(
      representations?.every(
        (representation) => representation?.kind === 'ocr_text' && representation.truncated
      )
    ).toBe(true)
    expect(diagnostics.map((event) => event.tokenCount)).toEqual(
      representations?.map((representation) =>
        representation?.kind === 'ocr_text' ? representation.tokenCount : undefined
      )
    )
    expect(extraction.extractBatch).not.toHaveBeenCalled()
  })

  it('bounds body-free issue reporting for oversized attachment lists', async () => {
    const { router } = createRouter({ automaticOcrEnabled: false })
    const result = await prepare(router, {
      text: '',
      files: Array.from({ length: 70 }, (_, index) => image(index + 1))
    })

    expect(result.summary.status).toBe('needs_user_action')
    expect(result.summary.issues).toHaveLength(64)
    expect(result.content.files).toHaveLength(70)
    expect(
      result.content.files?.every((file) => file.resolvedRepresentation?.kind === 'unavailable')
    ).toBe(true)
  })

  it('keeps retry guidance when issue reporting reaches its cap', async () => {
    const extraction = createExtraction({
      extractBatch: vi.fn(async () => [
        { status: 'rejected', reason: new ImageTextExtractionError('runtime_failure', 'failed') }
      ])
    })
    const { router } = createRouter({ extraction, automaticOcrEnabled: false })
    const result = await prepare(router, {
      text: '',
      files: [
        image(1, { requestedRepresentation: 'ocr_text' }),
        ...Array.from({ length: 64 }, (_, index) => image(index + 2))
      ]
    })

    expect(result.summary.issues).toHaveLength(64)
    expect(result.summary.suggestedActions).toContain('retry')
    expect(result.content.files?.[0].resolvedRepresentation).toEqual({
      kind: 'unavailable',
      reason: 'ocr_failed'
    })
  })

  it('preserves helper queue saturation as an actionable reason', async () => {
    const extraction = createExtraction({
      extractBatch: vi.fn(async () => [
        {
          status: 'rejected',
          reason: new LightOcrProcessHostError('queue_full', 'queue full')
        }
      ])
    })
    const { router } = createRouter({ extraction })

    const result = await prepare(router, { text: '', files: [image()] })

    expect(result.summary).toEqual({
      status: 'needs_user_action',
      issues: [{ attachmentIndex: 0, reason: 'ocr_queue_full' }],
      suggestedActions: ['switch_to_vision_model', 'send_without_image_content', 'retry']
    })
  })

  it('propagates cancellation instead of converting it into a user-action state', async () => {
    const controller = new AbortController()
    const extraction = createExtraction({
      extractBatch: vi.fn(async () => {
        controller.abort()
        throw new ImageTextExtractionError('cancelled', 'cancelled')
      })
    })
    const { router } = createRouter({ extraction })

    await expect(
      router.prepare({
        content: { text: '', files: [image()] },
        supportsVision: false,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('propagates PDF cancellation without creating an unavailable snapshot', async () => {
    const controller = new AbortController()
    const extraction = createExtraction({
      extractDocument: vi.fn(async () => {
        controller.abort()
        throw new DocumentTextExtractionError('cancelled', 'cancelled')
      })
    })
    const { router } = createRouter({ extraction })

    await expect(
      router.prepare({
        content: {
          text: '',
          files: [pdf(1, { pdfTextCoverage: pdfCoverage(10, 0) })]
        },
        supportsVision: false,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
