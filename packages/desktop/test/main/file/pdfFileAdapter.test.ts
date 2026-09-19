import { afterEach, describe, expect, it, vi } from 'vitest'

import { PdfFileAdapter, buildPdfEmbeddedTextCoverage } from '@/file/adapters/PdfFileAdapter'

describe('PdfFileAdapter embedded-text coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('counts substantive pages by Unicode code points and keeps bounded low-text samples', () => {
    const pages = [`${'字'.repeat(63)}😀`, 'short note', ...Array.from({ length: 24 }, () => '')]

    expect(buildPdfEmbeddedTextCoverage(26, pages)).toEqual({
      routingRevision: 'pdf-text-coverage-v1',
      pageCount: 26,
      substantivePageCount: 1,
      lowTextPageCount: 25,
      lowTextPageSamples: Array.from({ length: 20 }, (_, index) => index + 2),
      hasEmbeddedText: true
    })
  })

  it('treats missing parser pages as low text and rejects implausible page counts', () => {
    expect(buildPdfEmbeddedTextCoverage(3, ['text'])).toEqual({
      routingRevision: 'pdf-text-coverage-v1',
      pageCount: 3,
      substantivePageCount: 0,
      lowTextPageCount: 3,
      lowTextPageSamples: [1, 2, 3],
      hasEmbeddedText: true
    })
    expect(buildPdfEmbeddedTextCoverage(0, [])).toBeUndefined()
    expect(buildPdfEmbeddedTextCoverage(1_000_001, [])).toBeUndefined()
  })

  it('degrades filesystem read failures without retaining a rejected load promise', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const adapter = new PdfFileAdapter('/missing/deepchat-pdf-adapter-test.pdf', 1024)

    await expect(adapter.getTextCoverage()).resolves.toBeUndefined()
    await expect(adapter.getTextCoverage()).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledTimes(1)
  })
})
