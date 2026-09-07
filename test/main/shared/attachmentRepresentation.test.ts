import { describe, expect, it } from 'vitest'

import {
  AttachmentResolvedRepresentationSchema,
  PdfEmbeddedTextCoverageSchema,
  SendMessageInputSchema
} from '../../../src/shared/contracts/common'
import { PreparedMessageFileSchema } from '../../../src/shared/contracts/domainSchemas'
import {
  getAttachmentSearchableText,
  isAttachmentPreparationCandidate,
  isImageAttachment,
  isPdfAttachment,
  normalizeAttachmentRepresentationPreference,
  normalizeAttachmentRepresentationPreferenceForFile,
  normalizeAttachmentResolvedRepresentation,
  normalizePdfEmbeddedTextCoverage
} from '../../../src/shared/utils/attachmentRepresentation'

describe('attachment representation contracts', () => {
  it('accepts pending controls but strips main-owned attachment snapshots from input', () => {
    const parsed = SendMessageInputSchema.parse({
      text: '',
      attachmentFallbackPolicy: 'send_without_image_content',
      files: [
        {
          name: 'scan.png',
          path: '/tmp/scan.png',
          mimeType: 'image/png',
          requestedRepresentation: 'ocr_text',
          resolvedRepresentation: {
            kind: 'ocr_text',
            text: 'invoice total 42',
            tokenCount: 4,
            truncated: false
          }
        }
      ]
    })

    expect(parsed).toMatchObject({
      attachmentFallbackPolicy: 'send_without_image_content',
      files: [{ requestedRepresentation: 'ocr_text' }]
    })
    expect(parsed.files?.[0]).not.toHaveProperty('resolvedRepresentation')

    expect(
      AttachmentResolvedRepresentationSchema.parse({
        kind: 'ocr_text',
        text: 'invoice total 42',
        tokenCount: 4,
        truncated: false
      })
    ).toEqual({
      kind: 'ocr_text',
      text: 'invoice total 42',
      tokenCount: 4,
      truncated: false
    })
  })

  it('rejects malformed representations and normalizes corrupt persisted values away', () => {
    expect(
      AttachmentResolvedRepresentationSchema.safeParse({
        kind: 'ocr_text',
        text: 'missing metadata'
      }).success
    ).toBe(false)
    expect(normalizeAttachmentRepresentationPreference('always')).toBeUndefined()
    expect(
      normalizeAttachmentResolvedRepresentation({ kind: 'unavailable', reason: 'raw_error' })
    ).toBeUndefined()
    expect(
      normalizeAttachmentResolvedRepresentation({
        kind: 'ocr_text',
        text: '   ',
        tokenCount: 1,
        truncated: false
      })
    ).toBeUndefined()
    expect(
      normalizeAttachmentResolvedRepresentation({
        kind: 'ocr_text',
        text: 'x'.repeat(128_001),
        tokenCount: 1,
        truncated: false
      })
    ).toBeUndefined()
  })

  it('classifies images consistently from MIME, legacy type, or file extension', () => {
    expect(isImageAttachment({ name: 'scan', path: '/tmp/scan', mimeType: 'image/png' })).toBe(true)
    expect(isImageAttachment({ name: 'scan', path: '/tmp/scan', type: 'image' })).toBe(true)
    expect(isImageAttachment({ name: 'scan.PNG', path: '' })).toBe(true)
    expect(isImageAttachment({ name: 'scan.png', path: '/tmp/upload-without-extension' })).toBe(
      true
    )
    expect(isImageAttachment({ name: 'scan.png.txt', path: '' })).toBe(false)
  })

  it('classifies PDFs consistently and accepts the contextual embedded-text preference', () => {
    expect(isPdfAttachment({ name: 'scan', path: '/tmp/scan', mimeType: 'application/pdf' })).toBe(
      true
    )
    expect(isPdfAttachment({ name: 'scan', path: '/tmp/scan', type: 'pdf' })).toBe(true)
    expect(isPdfAttachment({ name: 'SCAN.PDF', path: '' })).toBe(true)
    expect(isPdfAttachment({ name: 'scan.pdf.txt', path: '' })).toBe(false)
    expect(isImageAttachment({ name: 'conflict.pdf', path: '', mimeType: 'image/png' })).toBe(true)
    expect(isPdfAttachment({ name: 'conflict.pdf', path: '', mimeType: 'image/png' })).toBe(false)
    expect(isImageAttachment({ name: 'conflict.png', path: '', mimeType: 'application/pdf' })).toBe(
      false
    )
    expect(isPdfAttachment({ name: 'conflict.png', path: '', mimeType: 'application/pdf' })).toBe(
      true
    )
    expect(normalizeAttachmentRepresentationPreference('embedded_text')).toBe('embedded_text')
    expect(
      normalizeAttachmentRepresentationPreferenceForFile(
        { name: 'scan.pdf', path: '', mimeType: 'application/pdf' },
        'embedded_text'
      )
    ).toBe('embedded_text')
    expect(
      normalizeAttachmentRepresentationPreferenceForFile(
        { name: 'scan.pdf', path: '', mimeType: 'application/pdf' },
        'image'
      )
    ).toBe('auto')
    expect(
      normalizeAttachmentRepresentationPreferenceForFile(
        { name: 'scan.png', path: '', mimeType: 'image/png' },
        'embedded_text'
      )
    ).toBe('auto')
    expect(
      isAttachmentPreparationCandidate({
        name: 'scan.pdf',
        path: '',
        mimeType: 'application/pdf'
      })
    ).toBe(true)
    expect(
      isAttachmentPreparationCandidate({ name: 'notes.txt', path: '', mimeType: 'text/plain' })
    ).toBe(false)
  })

  it('selects searchable attachment text from the resolved representation', () => {
    expect(
      getAttachmentSearchableText({
        name: 'scan.png',
        mimeType: 'image/png',
        resolvedRepresentation: {
          kind: 'ocr_text',
          text: 'recognized image text',
          tokenCount: 3,
          truncated: false
        }
      })
    ).toBe('recognized image text')
    expect(
      getAttachmentSearchableText({
        name: 'report.pdf',
        mimeType: 'application/pdf',
        content: 'embedded PDF text',
        resolvedRepresentation: { kind: 'embedded_text' }
      })
    ).toBe('embedded PDF text')
    expect(
      getAttachmentSearchableText({
        name: 'notes.txt',
        mimeType: 'text/plain',
        content: 'plain file text',
        resolvedRepresentation: { kind: 'embedded_text' }
      })
    ).toBe('')
  })

  it('normalizes bounded PDF embedded-text coverage and rejects inconsistent samples', () => {
    const coverage = {
      routingRevision: 'pdf-text-coverage-v1',
      pageCount: 5,
      substantivePageCount: 4,
      lowTextPageCount: 1,
      lowTextPageSamples: [5],
      hasEmbeddedText: true
    }

    expect(PdfEmbeddedTextCoverageSchema.parse(coverage)).toEqual(coverage)
    expect(normalizePdfEmbeddedTextCoverage(coverage)).toEqual(coverage)
    expect(
      PreparedMessageFileSchema.parse({
        name: 'scan.pdf',
        path: '/tmp/scan.pdf',
        pdfTextCoverage: coverage
      }).pdfTextCoverage
    ).toEqual(coverage)
    expect(
      normalizePdfEmbeddedTextCoverage({
        ...coverage,
        lowTextPageCount: 2
      })
    ).toBeUndefined()
    expect(
      PdfEmbeddedTextCoverageSchema.safeParse({
        ...coverage,
        lowTextPageSamples: [5, 4]
      }).success
    ).toBe(false)
  })

  it('validates page-aware PDF OCR snapshots without raising the image OCR token cap', () => {
    const text = '## Page 1\n\nrecognized document text'
    const documentRepresentation = {
      kind: 'ocr_text' as const,
      text,
      tokenCount: 9_000,
      truncated: false,
      document: {
        pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
        sourcePageCountHint: 1,
        includedThroughPage: 1,
        includedThroughPageComplete: true,
        artifactTermination: 'request_complete' as const,
        generationOutputLimitReached: false
      }
    }

    expect(AttachmentResolvedRepresentationSchema.parse(documentRepresentation)).toEqual(
      documentRepresentation
    )
    expect(normalizeAttachmentResolvedRepresentation(documentRepresentation)).toEqual(
      documentRepresentation
    )
    expect(
      normalizeAttachmentResolvedRepresentation({
        ...documentRepresentation,
        document: {
          ...documentRepresentation.document,
          pageSpans: [
            {
              ...documentRepresentation.document.pageSpans[0],
              ignoredPersistedField: 'discard me'
            }
          ]
        }
      })
    ).toEqual(documentRepresentation)
    expect(
      normalizeAttachmentResolvedRepresentation({
        ...documentRepresentation,
        document: {
          ...documentRepresentation.document,
          includedThroughPage: 2
        }
      })
    ).toEqual({ kind: 'unavailable', reason: 'invalid_attachment_snapshot' })
    expect(
      AttachmentResolvedRepresentationSchema.safeParse({
        kind: 'ocr_text',
        text: 'image text',
        tokenCount: 9_000,
        truncated: false
      }).success
    ).toBe(false)
    expect(
      AttachmentResolvedRepresentationSchema.safeParse({
        ...documentRepresentation,
        document: {
          ...documentRepresentation.document,
          pageSpans: []
        }
      }).success
    ).toBe(false)
  })

  it.each([
    {
      name: 'page heading does not match its span',
      text: '## Page 2\n\nrecognized document text',
      pageSpans: [
        {
          pageNumber: 1,
          start: 0,
          end: '## Page 2\n\nrecognized document text'.length,
          complete: true
        }
      ],
      generationOutputLimitReached: false
    },
    {
      name: 'partial page omits the truncation marker',
      text: '## Page 1\n\npartial text',
      pageSpans: [
        {
          pageNumber: 1,
          start: 0,
          end: '## Page 1\n\npartial text'.length,
          complete: false
        }
      ],
      generationOutputLimitReached: true
    },
    {
      name: 'partial page joins text directly to the truncation marker',
      text: '## Page 1\n\npartial text[… PDF OCR truncated …]',
      pageSpans: [
        {
          pageNumber: 1,
          start: 0,
          end: '## Page 1\n\npartial text[… PDF OCR truncated …]'.length,
          complete: false
        }
      ],
      generationOutputLimitReached: true
    },
    {
      name: 'complete page contains a heading without a body',
      text: '## Page 1\n\n',
      pageSpans: [
        {
          pageNumber: 1,
          start: 0,
          end: '## Page 1\n\n'.length,
          complete: true
        }
      ],
      generationOutputLimitReached: false
    },
    {
      name: 'contiguous offsets split the next page heading',
      text: '## Page 1\n\nfirst\n\n## Page 2\n\nsecond',
      pageSpans: [
        { pageNumber: 1, start: 0, end: '## Page 1\n\nfirst\n\n#'.length, complete: true },
        {
          pageNumber: 2,
          start: '## Page 1\n\nfirst\n\n#'.length,
          end: '## Page 1\n\nfirst\n\n## Page 2\n\nsecond'.length,
          complete: true
        }
      ],
      generationOutputLimitReached: false
    }
  ])('rejects corrupt persisted PDF OCR coverage: $name', (fixture) => {
    const representation = {
      kind: 'ocr_text' as const,
      text: fixture.text,
      tokenCount: 10,
      truncated: fixture.generationOutputLimitReached,
      document: {
        pageSpans: fixture.pageSpans,
        includedThroughPage: fixture.pageSpans.at(-1)!.pageNumber,
        includedThroughPageComplete: fixture.pageSpans.at(-1)!.complete,
        artifactTermination: fixture.generationOutputLimitReached
          ? ('stopped_by_output_limit' as const)
          : ('request_complete' as const),
        generationOutputLimitReached: fixture.generationOutputLimitReached
      }
    }

    expect(AttachmentResolvedRepresentationSchema.safeParse(representation).success).toBe(false)
    expect(normalizeAttachmentResolvedRepresentation(representation)).toEqual({
      kind: 'unavailable',
      reason: 'invalid_attachment_snapshot'
    })
  })

  it('treats malformed legacy attachment metadata as non-image data', () => {
    expect(isImageAttachment(null)).toBe(false)
    expect(isImageAttachment(undefined)).toBe(false)
    expect(
      isImageAttachment({
        name: 42,
        path: null,
        type: { value: 'image' },
        mimeType: ['image/png']
      } as any)
    ).toBe(false)
    expect(isImageAttachment({ name: null, path: '/tmp/legacy.PNG', mimeType: 42 } as any)).toBe(
      true
    )
  })
})
