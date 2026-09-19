import { describe, expect, it } from 'vitest'

import {
  LIGHT_OCR_DOCUMENT_MAX_LINE_CHARACTERS,
  LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS,
  LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  isLightOcrDocumentOptions,
  isLightOcrDocumentPage,
  isLightOcrHelperMessage,
  isLightOcrHelperRequest,
  type LightOcrDocumentOptions,
  type LightOcrDocumentPage
} from '../../../src/main/ocr/lightOcrProtocol'

const documentOptions: LightOcrDocumentOptions = {
  dpi: 150,
  pageRange: { start: 1, end: 100 },
  maxPages: 100,
  maxFileBytes: LIGHT_OCR_HELPER_MAX_INPUT_BYTES,
  maxPagePixels: LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
  maxTotalPixels: LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS
}

const documentPage: LightOcrDocumentPage = {
  index: 0,
  width: 1_240,
  height: 1_755,
  lines: ['page text'],
  modelBundleId: 'ppocrv6-small-test',
  timingUs: { total: 3, decode: 1, ocr: 2 }
}

describe('Light OCR protocol v2', () => {
  it('requires bounded explicit options for document recognition', () => {
    expect(isLightOcrDocumentOptions(documentOptions)).toBe(true)
    expect(
      isLightOcrHelperRequest({
        type: 'recognize_document',
        id: 'document',
        filePath: '/private/document.pdf',
        backend: 'cpu',
        strategy: 'bounded-960',
        options: documentOptions
      })
    ).toBe(true)

    expect(isLightOcrDocumentOptions({ ...documentOptions, pageRange: undefined })).toBe(false)
    expect(
      isLightOcrDocumentOptions({
        ...documentOptions,
        pageRange: { start: 1, end: 101 }
      })
    ).toBe(false)
    expect(
      isLightOcrDocumentOptions({
        ...documentOptions,
        maxFileBytes: LIGHT_OCR_HELPER_MAX_INPUT_BYTES + 1
      })
    ).toBe(false)
    expect(
      isLightOcrHelperRequest({
        type: 'document_stop',
        id: 'stop',
        targetId: ''
      })
    ).toBe(false)
  })

  it('validates bounded document page payloads without quadrilateral boxes', () => {
    expect(isLightOcrDocumentPage(documentPage)).toBe(true)
    expect(
      isLightOcrHelperMessage({
        type: 'document_page',
        id: 'document',
        page: documentPage
      })
    ).toBe(true)
    expect(
      isLightOcrHelperMessage({
        type: 'request_complete',
        id: 'document',
        emittedPages: 1
      })
    ).toBe(true)

    expect(isLightOcrDocumentPage({ ...documentPage, index: -1 })).toBe(false)
    expect(
      isLightOcrDocumentPage({
        ...documentPage,
        width: LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS,
        height: 2
      })
    ).toBe(false)
    expect(
      isLightOcrDocumentPage({
        ...documentPage,
        lines: ['x'.repeat(LIGHT_OCR_DOCUMENT_MAX_LINE_CHARACTERS + 1)]
      })
    ).toBe(false)
    expect(
      isLightOcrHelperMessage({
        type: 'request_complete',
        id: 'document',
        emittedPages: -1
      })
    ).toBe(false)
  })
})
