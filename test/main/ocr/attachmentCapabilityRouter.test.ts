import { describe, expect, it, vi } from 'vitest'

import {
  AttachmentCapabilityRouter,
  type AttachmentOcrRuntimePort
} from '@/ocr/attachmentCapabilityRouter'
import { ImagePreprocessingError } from '@/ocr/imagePreprocessor'
import { ImageTextExtractionError } from '@/ocr/imageTextExtractionService'
import { LightOcrProcessHostError } from '@/ocr/lightOcrProcessHost'
import type { MessageFile, SendMessageInput } from '@shared/types/agent-interface'

const AVAILABLE = {
  status: 'available' as const,
  assets: {
    nodeExecutable: '/runtime/node',
    helperEntryPath: '/runtime/helper.js',
    facadeDir: '/runtime/facade',
    bundlePath: '/runtime/bundle',
    nativePackageDir: '/runtime/native',
    nativePayloadEncoding: 'gzip-base64-v1' as const,
    nativePackage: '@arcships/light-ocr-native-test',
    lightOcrVersion: '0.3.4',
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

function image(index = 1, overrides: Partial<MessageFile> = {}): MessageFile {
  return {
    name: `image-${index}.png`,
    path: `/tmp/image-${index}.png`,
    mimeType: 'image/png',
    content: 'data:image/png;base64,AA==',
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
  reusePreparedOcrText = false,
  preserveResolvedRepresentations = false
) {
  return await router.prepare({
    content,
    supportsVision,
    reusePreparedOcrText,
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
        lightOcrVersion: '0.3.4',
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
})
