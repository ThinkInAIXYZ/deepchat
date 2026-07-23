import { describe, expect, it } from 'vitest'
import { FileAttachment } from '@/components/chat/nodes/fileAttachment'

describe('fileAttachment node', () => {
  it.each([
    ['ocr_text', 'ocr_text'],
    ['image', 'image'],
    ['auto', 'auto'],
    ['invalid', 'auto'],
    [null, 'auto']
  ])('normalizes the parsed representation %s to %s', (value, expected) => {
    const attributes = FileAttachment.config.addAttributes?.call(FileAttachment)
    const parseRepresentation = attributes?.requestedRepresentation?.parseHTML
    const element = document.createElement('span')
    if (value) element.setAttribute('data-requested-representation', value)

    expect(parseRepresentation?.(element)).toBe(expected)
  })
})
