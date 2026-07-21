import { describe, expect, it } from 'vitest'

import {
  AttachmentResolvedRepresentationSchema,
  SendMessageInputSchema
} from '../../../src/shared/contracts/common'
import {
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
})
