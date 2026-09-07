import { describe, expect, it } from 'vitest'

import packageJson from '../../../package.json'
import {
  DocumentOcrTextAssembler,
  PDF_OCR_ARTIFACT_REVISION,
  PDF_OCR_TRUNCATION_MARKER,
  compareDocumentOcrCoverage,
  estimateDocumentOcrTokens,
  isDocumentOcrBudgetCompatible,
  isValidDocumentOcrArtifact,
  truncateDocumentOcrArtifact,
  type DocumentOcrArtifactIdentity,
  type DocumentOcrArtifactValue
} from '../../../src/main/ocr/documentOcrArtifact'
import type {
  LightOcrDocumentPage,
  LightOcrEngineStatus
} from '../../../src/main/ocr/lightOcrProtocol'

function engine(): LightOcrEngineStatus {
  return {
    coreVersion: 'core-1',
    modelBundleId: 'bundle-1',
    requestedProvider: 'auto',
    strategy: 'bounded-960',
    detection: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId: 'detection-q'
    },
    recognition: {
      actualProviderChain: ['coreml', 'cpu'],
      precision: 'fp16',
      qualificationId: 'recognition-q'
    }
  }
}

function identity(): DocumentOcrArtifactIdentity {
  return {
    sourceSha256: 'a'.repeat(64),
    facadeVersion: '0.5.5',
    runtimeVersion: '0.1.5',
    nativeVersion: '0.5.5',
    modelVersion: '0.3.4',
    bundleId: 'bundle-1',
    artifactRevision: PDF_OCR_ARTIFACT_REVISION,
    strategy: 'bounded-960',
    requestedBackend: 'auto',
    detectionProviderChain: ['coreml', 'cpu'],
    detectionPrecision: 'fp16',
    recognitionProviderChain: ['coreml', 'cpu'],
    recognitionPrecision: 'fp16',
    dpi: 150,
    pageRangeStart: 1,
    pageRangeEnd: 100,
    maxPages: 100,
    maxFileBytes: 50 * 1024 * 1024,
    maxPagePixels: 4096 * 4096,
    maxTotalPixels: 100 * 1024 * 1024
  }
}

function page(index: number, text: string): LightOcrDocumentPage {
  return {
    index,
    width: 100,
    height: 200,
    lines: [text],
    modelBundleId: 'bundle-1',
    timingUs: { total: 3, decode: 1, ocr: 2 }
  }
}

function artifact(overrides: Partial<DocumentOcrArtifactValue> = {}): DocumentOcrArtifactValue {
  const text = '## Page 1\n\nfirst page'
  return {
    text,
    tokenCount: estimateDocumentOcrTokens(text),
    pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: true }],
    artifactTermination: 'request_complete',
    generationOutputLimitReached: false,
    generationTokenLimit: 16_000,
    emittedPages: 1,
    sourcePageCountHint: 1,
    engine: engine(),
    ...overrides
  }
}

describe('document OCR artifacts', () => {
  it('normalizes pages and keeps complete page spans contiguous', () => {
    const assembler = new DocumentOcrTextAssembler(1)
    expect(assembler.append(page(0, 'first\u0000\r\nline  '))).toBe('continue')
    expect(assembler.append(page(1, 'second page'))).toBe('continue')

    const result = assembler.snapshot()
    expect(result).toMatchObject({
      text: '## Page 1\n\nfirst\nline\n\n## Page 2\n\nsecond page',
      truncated: false,
      pageSpans: [
        { pageNumber: 1, start: 0, complete: true },
        { pageNumber: 2, complete: true }
      ]
    })
    expect(result.pageSpans[0].end).toBe(result.pageSpans[1].start)
    expect(result.pageSpans[1].end).toBe(result.text.length)
    expect(result.tokenCount).toBe(estimateDocumentOcrTokens(result.text))
  })

  it('keeps the cache revision synchronized with the exact token estimator version', () => {
    expect(packageJson.dependencies.tokenx).toBe('0.4.1')
    expect(PDF_OCR_ARTIFACT_REVISION).toContain(`tokenx=${packageJson.dependencies.tokenx}`)
  })

  it('uses a page-aware prefix and never retains the tail after the output limit', () => {
    const assembler = new DocumentOcrTextAssembler(1, 16_000, 90)
    expect(assembler.append(page(0, 'A'.repeat(20)))).toBe('continue')
    expect(assembler.append(page(1, `prefix-${'B'.repeat(100)}-forbidden-tail`))).toBe(
      'output_limit_reached'
    )

    const result = assembler.snapshot()
    expect(result.text).toContain('## Page 1')
    expect(result.text).toContain('## Page 2')
    expect(result.text).toContain(PDF_OCR_TRUNCATION_MARKER)
    expect(result.text).not.toContain('forbidden-tail')
    expect(result.pageSpans.at(-1)).toMatchObject({ pageNumber: 2, complete: false })
    expect(result.text.length).toBeLessThanOrEqual(90)
  })

  it('backs up to the preceding page when a new page heading and marker do not fit', () => {
    const firstText = 'A'.repeat(60)
    const assembler = new DocumentOcrTextAssembler(1, 16_000, 80)
    expect(assembler.append(page(0, firstText))).toBe('continue')
    expect(assembler.append(page(1, 'B'.repeat(60)))).toBe('output_limit_reached')

    const result = assembler.snapshot()
    expect(result.text).toContain('## Page 1')
    expect(result.text).not.toContain('## Page 2')
    expect(result.text).toContain(PDF_OCR_TRUNCATION_MARKER)
    expect(result.pageSpans).toHaveLength(1)
    expect(result.pageSpans[0]).toMatchObject({ pageNumber: 1, complete: false })
  })

  it('records empty pages as coverage without turning headings into recognized text', () => {
    const assembler = new DocumentOcrTextAssembler(1)
    expect(assembler.append(page(0, ' \r\n\u0000'))).toBe('continue')
    expect(assembler.append(page(1, ''))).toBe('continue')

    expect(assembler.snapshot()).toEqual({
      text: '',
      tokenCount: 0,
      truncated: false,
      pageSpans: [
        { pageNumber: 1, start: 0, end: 0, complete: true },
        { pageNumber: 2, start: 0, end: 0, complete: true }
      ]
    })
  })

  it('derives a lower-budget view without mutating the cached artifact', () => {
    const assembler = new DocumentOcrTextAssembler(1)
    assembler.append(page(0, 'A'.repeat(500)))
    assembler.append(page(1, 'B'.repeat(500)))
    const complete = assembler.snapshot()
    const cached = artifact({
      ...complete,
      artifactTermination: 'request_complete',
      generationOutputLimitReached: false,
      generationTokenLimit: 16_000,
      emittedPages: 2,
      sourcePageCountHint: 2
    })

    const limited = truncateDocumentOcrArtifact(cached, 40)
    expect(limited.artifactTermination).toBe('request_complete')
    expect(limited.generationOutputLimitReached).toBe(true)
    expect(limited.generationTokenLimit).toBe(40)
    expect(limited.pageSpans.at(-1)?.complete).toBe(false)
    expect(limited.text).toContain(PDF_OCR_TRUNCATION_MARKER)
    expect(cached.generationOutputLimitReached).toBe(false)
    expect(cached.pageSpans.at(-1)?.complete).toBe(true)
  })

  it('uses only the persisted output-limit fact for budget compatibility', () => {
    expect(isDocumentOcrBudgetCompatible(artifact(), 32_000)).toBe(true)
    expect(
      isDocumentOcrBudgetCompatible(
        artifact({
          generationOutputLimitReached: true,
          pageSpans: [
            {
              pageNumber: 1,
              start: 0,
              end: '## Page 1\n\n[… PDF OCR truncated …]'.length,
              complete: false
            }
          ],
          text: '## Page 1\n\n[… PDF OCR truncated …]',
          tokenCount: estimateDocumentOcrTokens('## Page 1\n\n[… PDF OCR truncated …]')
        }),
        16_001
      )
    ).toBe(false)
  })

  it('orders replacement candidates by retained text coverage rather than emitted pages', () => {
    const base = artifact()
    const complete = artifact({ emittedPages: 1 })
    const partialText = '## Page 1\n\nfirst\n\n[… PDF OCR truncated …]'
    const partial = artifact({
      text: partialText,
      tokenCount: estimateDocumentOcrTokens(partialText),
      pageSpans: [{ pageNumber: 1, start: 0, end: partialText.length, complete: false }],
      artifactTermination: 'resource_limited',
      generationOutputLimitReached: true,
      emittedPages: 50,
      resourceLimit: { code: 'resource_limit_exceeded', message: 'pixel limit' }
    })

    expect(compareDocumentOcrCoverage(complete, partial)).toBeGreaterThan(0)
    expect(compareDocumentOcrCoverage(partial, complete)).toBeLessThan(0)
    expect(
      compareDocumentOcrCoverage(
        { ...base, generationTokenLimit: 16_000 },
        { ...base, generationTokenLimit: 8_000 }
      )
    ).toBeGreaterThan(0)
  })

  it('prefers identical retained coverage that did not reach the generation output limit', () => {
    const text = '## Page 1\n\nfirst\n\n[… PDF OCR truncated …]'
    const shared = artifact({
      text,
      tokenCount: estimateDocumentOcrTokens(text),
      pageSpans: [{ pageNumber: 1, start: 0, end: text.length, complete: false }],
      artifactTermination: 'resource_limited',
      emittedPages: 1,
      resourceLimit: { code: 'resource_limit_exceeded', message: 'pixel limit' }
    })
    const reusableForLargerBudgets = {
      ...shared,
      generationOutputLimitReached: false
    }
    const limitedToItsGenerationBudget = {
      ...shared,
      generationOutputLimitReached: true
    }

    expect(isValidDocumentOcrArtifact(reusableForLargerBudgets, identity())).toBe(true)
    expect(isValidDocumentOcrArtifact(limitedToItsGenerationBudget, identity())).toBe(true)
    expect(
      compareDocumentOcrCoverage(reusableForLargerBudgets, limitedToItsGenerationBudget)
    ).toBeGreaterThan(0)
    expect(
      compareDocumentOcrCoverage(limitedToItsGenerationBudget, reusableForLargerBudgets)
    ).toBeLessThan(0)
  })

  it('rejects illegal termination, coverage, and engine identity combinations', () => {
    expect(isValidDocumentOcrArtifact(artifact(), identity())).toBe(true)
    expect(
      isValidDocumentOcrArtifact(
        artifact({
          artifactTermination: 'stopped_by_output_limit',
          generationOutputLimitReached: false
        }),
        identity()
      )
    ).toBe(false)
    expect(
      isValidDocumentOcrArtifact(
        artifact({
          artifactTermination: 'resource_limited',
          resourceLimit: undefined
        }),
        identity()
      )
    ).toBe(false)
    expect(
      isValidDocumentOcrArtifact(
        artifact({
          pageSpans: [{ pageNumber: 2, start: 0, end: 5, complete: true }]
        }),
        identity()
      )
    ).toBe(false)
    expect(
      isValidDocumentOcrArtifact(
        artifact({
          engine: {
            ...engine(),
            detection: {
              ...engine().detection,
              actualProviderChain: ['cpu']
            }
          }
        }),
        identity()
      )
    ).toBe(false)
  })
})
