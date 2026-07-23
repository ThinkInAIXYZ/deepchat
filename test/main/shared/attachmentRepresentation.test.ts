import { describe, expect, it } from 'vitest'

import {
  AttachmentResolvedRepresentationSchema,
  SendMessageInputSchema
} from '../../../src/shared/contracts/common'
import {
  isImageAttachment,
  normalizeAttachmentRepresentationPreference,
  normalizeAttachmentResolvedRepresentation
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
