import { approximateTokenSize } from 'tokenx'

import type {
  LightOcrDocumentPage,
  LightOcrEngineStatus,
  LightOcrRecognitionStrategy
} from './lightOcrProtocol'
import { isLightOcrEngineStatus } from './lightOcrProtocol'
import type { LightOcrBackendPreference } from './lightOcrProtocol'
import type { LightOcrDocumentArtifactTermination } from './lightOcrProcessHost'
import {
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS,
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  PDF_PAGE_COUNT_SANITY_LIMIT
} from '@shared/types/attachment'
import {
  PDF_OCR_TRUNCATION_MARKER as SHARED_PDF_OCR_TRUNCATION_MARKER,
  isValidDocumentOcrTextPageSpans
} from '@shared/utils/documentOcrText'

export const PDF_OCR_GENERATION_MAX_TOKENS = ATTACHMENT_PDF_OCR_MAX_TOKENS
export const PDF_OCR_STRATEGY: LightOcrRecognitionStrategy = 'bounded-960'
export const PDF_OCR_TRUNCATION_MARKER = SHARED_PDF_OCR_TRUNCATION_MARKER
export const PDF_OCR_ARTIFACT_REVISION = [
  'pdf-ocr-artifact-v1',
  'page-heading-v1',
  'page-prefix-truncation-v1',
  'unicode-normalization-v1',
  'tokenx=0.4.1',
  `max-characters=${ATTACHMENT_OCR_MAX_TEXT_CHARACTERS}`
].join(';')

const MAX_RESOURCE_ERROR_CHARACTERS = 2_048
const TOKEN_ESTIMATE_CACHE = new WeakMap<object, { text: string; tokenCount: number }>()

export interface DocumentOcrPageSpan {
  readonly pageNumber: number
  readonly start: number
  readonly end: number
  readonly complete: boolean
}

export interface DocumentOcrResourceLimit {
  readonly code: 'resource_limit_exceeded'
  readonly message: string
  readonly detail?: string
}

export interface DocumentOcrArtifactIdentity {
  readonly sourceSha256: string
  readonly facadeVersion: string
  readonly runtimeVersion: string
  readonly nativeVersion: string
  readonly modelVersion: string
  readonly bundleId: string
  readonly artifactRevision: string
  readonly strategy: LightOcrRecognitionStrategy
  readonly requestedBackend: LightOcrBackendPreference
  readonly detectionProviderChain: ReadonlyArray<string>
  readonly detectionPrecision: string
  readonly recognitionProviderChain: ReadonlyArray<string>
  readonly recognitionPrecision: string
  readonly dpi: number
  readonly pageRangeStart: number
  readonly pageRangeEnd: number
  readonly maxPages: number
  readonly maxFileBytes: number
  readonly maxPagePixels: number
  readonly maxTotalPixels: number
}

export interface DocumentOcrArtifactValue {
  readonly text: string
  readonly tokenCount: number
  readonly pageSpans: ReadonlyArray<DocumentOcrPageSpan>
  readonly artifactTermination: LightOcrDocumentArtifactTermination
  readonly generationOutputLimitReached: boolean
  readonly generationTokenLimit: number
  readonly emittedPages: number
  readonly sourcePageCountHint?: number
  readonly resourceLimit?: DocumentOcrResourceLimit
  readonly engine: LightOcrEngineStatus
}

export interface DocumentOcrArtifact extends DocumentOcrArtifactValue {
  readonly cacheKey: string
}

export interface BoundedDocumentOcrText {
  readonly text: string
  readonly tokenCount: number
  readonly pageSpans: ReadonlyArray<DocumentOcrPageSpan>
  readonly truncated: boolean
}

interface DocumentOcrSourcePage {
  readonly pageNumber: number
  readonly text: string
  readonly complete: boolean
}

export class DocumentOcrTextAssembler {
  private readonly pages: DocumentOcrSourcePage[] = []
  private text = ''
  private tokenCount = 0
  private pageSpans: DocumentOcrPageSpan[] = []
  private truncated = false

  constructor(
    private readonly startPage: number,
    private readonly maxTokens = PDF_OCR_GENERATION_MAX_TOKENS,
    private readonly maxCharacters = ATTACHMENT_OCR_MAX_TEXT_CHARACTERS
  ) {
    assertPositiveInteger(startPage, 'startPage')
    assertPositiveInteger(maxTokens, 'maxTokens')
    assertPositiveInteger(maxCharacters, 'maxCharacters')
  }

  append(page: LightOcrDocumentPage): 'continue' | 'output_limit_reached' {
    if (this.truncated) return 'output_limit_reached'
    const pageNumber = page.index + 1
    if (pageNumber !== this.startPage + this.pages.length) {
      throw new Error('Document OCR pages must be appended in ascending order')
    }
    const sourcePage: DocumentOcrSourcePage = {
      pageNumber,
      text: normalizeDocumentOcrPageText(page.lines),
      complete: true
    }
    this.pages.push(sourcePage)

    const chunk = formatCompletePage(sourcePage, this.text.length > 0)
    // Every non-empty page chunk starts with a whitespace-separated heading, so tokenx cannot
    // merge a token across the page boundary and the per-chunk estimates remain additive.
    const nextTokenCount = this.tokenCount + estimateDocumentOcrTokens(chunk)
    if (this.text.length + chunk.length <= this.maxCharacters && nextTokenCount <= this.maxTokens) {
      const start = this.text.length
      this.text += chunk
      this.tokenCount = nextTokenCount
      this.pageSpans.push({
        pageNumber,
        start,
        end: this.text.length,
        complete: true
      })
      return 'continue'
    }

    const bounded = fitTruncatedPrefix(
      this.pages,
      this.pages.length - 1,
      this.maxTokens,
      this.maxCharacters
    )
    this.text = bounded.text
    this.tokenCount = bounded.tokenCount
    this.pageSpans = [...bounded.pageSpans]
    this.truncated = true
    return 'output_limit_reached'
  }

  snapshot(): BoundedDocumentOcrText {
    return {
      text: this.text,
      tokenCount: this.tokenCount,
      pageSpans: this.pageSpans.map((span) => ({ ...span })),
      truncated: this.truncated
    }
  }
}

export function normalizeDocumentOcrPageText(lines: ReadonlyArray<string>): string {
  return lines
    .map((line) => line.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

function fitDocumentOcrPages(
  pages: ReadonlyArray<DocumentOcrSourcePage>,
  maxTokens: number,
  maxCharacters = ATTACHMENT_OCR_MAX_TEXT_CHARACTERS
): BoundedDocumentOcrText {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0 || maxCharacters <= 0) {
    return { text: '', tokenCount: 0, pageSpans: [], truncated: pages.length > 0 }
  }

  let text = ''
  const pageSpans: DocumentOcrPageSpan[] = []
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (!page.complete) {
      return fitTruncatedPrefix(pages, index, maxTokens, maxCharacters)
    }
    const chunk = formatCompletePage(page, text.length > 0)
    const candidate = text + chunk
    if (!fitsDocumentBudget(candidate, maxTokens, maxCharacters)) {
      return fitTruncatedPrefix(pages, index, maxTokens, maxCharacters)
    }
    const start = text.length
    text = candidate
    pageSpans.push({
      pageNumber: page.pageNumber,
      start,
      end: text.length,
      complete: true
    })
  }

  return {
    text,
    tokenCount: estimateDocumentOcrTokens(text),
    pageSpans,
    truncated: false
  }
}

export function truncateDocumentOcrArtifact(
  artifact: DocumentOcrArtifactValue,
  maxTokens: number,
  maxCharacters = ATTACHMENT_OCR_MAX_TEXT_CHARACTERS
): DocumentOcrArtifactValue {
  const bounded = truncateDocumentOcrText(artifact, maxTokens, maxCharacters)
  return {
    ...artifact,
    text: bounded.text,
    tokenCount: bounded.tokenCount,
    pageSpans: bounded.pageSpans,
    generationOutputLimitReached: artifact.generationOutputLimitReached || bounded.truncated,
    generationTokenLimit: maxTokens,
    engine: structuredClone(artifact.engine),
    ...(artifact.resourceLimit ? { resourceLimit: { ...artifact.resourceLimit } } : {})
  }
}

export function truncateDocumentOcrText(
  source: Pick<BoundedDocumentOcrText, 'text' | 'pageSpans'>,
  maxTokens: number,
  maxCharacters = ATTACHMENT_OCR_MAX_TEXT_CHARACTERS
): BoundedDocumentOcrText {
  const sourcePages = reconstructSourcePages(source.text, source.pageSpans)
  return fitDocumentOcrPages(sourcePages, maxTokens, maxCharacters)
}

export function isDocumentOcrBudgetCompatible(
  artifact: DocumentOcrArtifactValue,
  requestedGenerationTokenLimit: number
): boolean {
  return (
    Number.isInteger(requestedGenerationTokenLimit) &&
    requestedGenerationTokenLimit > 0 &&
    (!artifact.generationOutputLimitReached ||
      requestedGenerationTokenLimit <= artifact.generationTokenLimit)
  )
}

export function compareDocumentOcrCoverage(
  left: DocumentOcrArtifactValue,
  right: DocumentOcrArtifactValue
): number {
  const leftLast = left.pageSpans.at(-1)
  const rightLast = right.pageSpans.at(-1)
  const comparisons = [
    Number(isCompleteRequestedScope(left)) - Number(isCompleteRequestedScope(right)),
    (leftLast?.pageNumber ?? 0) - (rightLast?.pageNumber ?? 0),
    Number(leftLast?.complete ?? false) - Number(rightLast?.complete ?? false),
    retainedSpanCharacters(leftLast) - retainedSpanCharacters(rightLast),
    Number(!left.generationOutputLimitReached) - Number(!right.generationOutputLimitReached),
    left.generationTokenLimit - right.generationTokenLimit
  ]
  return comparisons.find((comparison) => comparison !== 0) ?? 0
}

export function isValidDocumentOcrArtifact(
  value: unknown,
  identity?: DocumentOcrArtifactIdentity
): value is DocumentOcrArtifactValue {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.text !== 'string' ||
    candidate.text.length > ATTACHMENT_OCR_MAX_TEXT_CHARACTERS ||
    !isNonNegativeInteger(candidate.tokenCount) ||
    !hasConsistentTokenCount(candidate, candidate.text, candidate.tokenCount) ||
    !Array.isArray(candidate.pageSpans) ||
    !isValidPageSpans(candidate.text, candidate.pageSpans) ||
    !isArtifactTermination(candidate.artifactTermination) ||
    typeof candidate.generationOutputLimitReached !== 'boolean' ||
    !isIntegerInRange(candidate.generationTokenLimit, 1, PDF_OCR_GENERATION_MAX_TOKENS) ||
    !isNonNegativeInteger(candidate.emittedPages) ||
    (candidate.sourcePageCountHint !== undefined &&
      !isIntegerInRange(candidate.sourcePageCountHint, 1, PDF_PAGE_COUNT_SANITY_LIMIT)) ||
    !isLightOcrEngineStatus(candidate.engine)
  ) {
    return false
  }

  const pageSpans = candidate.pageSpans as DocumentOcrPageSpan[]
  const requestedPages = identity
    ? identity.pageRangeEnd - identity.pageRangeStart + 1
    : Number.POSITIVE_INFINITY
  if (
    candidate.emittedPages > requestedPages ||
    candidate.emittedPages < pageSpans.length ||
    (!candidate.generationOutputLimitReached && candidate.emittedPages !== pageSpans.length) ||
    (candidate.generationOutputLimitReached &&
      (pageSpans.length === 0 || pageSpans.at(-1)?.complete !== false))
  ) {
    return false
  }
  if (
    identity &&
    (!matchesDocumentEngineIdentity(candidate.engine, identity) ||
      pageSpans.some(
        (span, index) =>
          span.pageNumber !== identity.pageRangeStart + index ||
          span.pageNumber > identity.pageRangeEnd
      ))
  ) {
    return false
  }

  const termination = candidate.artifactTermination as LightOcrDocumentArtifactTermination
  if (
    termination === 'stopped_by_output_limit' &&
    (!candidate.generationOutputLimitReached || pageSpans.length === 0 || !candidate.text.trim())
  ) {
    return false
  }
  if (termination === 'resource_limited') {
    if (candidate.emittedPages < 1 || pageSpans.length < 1) return false
    if (!isResourceLimit(candidate.resourceLimit)) return false
  } else if (candidate.resourceLimit !== undefined) {
    return false
  }
  return true
}

export function estimateDocumentOcrTokens(text: string): number {
  try {
    const estimate = approximateTokenSize(text)
    if (Number.isFinite(estimate) && estimate >= 0 && (text.length === 0 || estimate > 0)) {
      return Math.ceil(estimate)
    }
  } catch {
    // Fall through to a conservative byte-level bound.
  }
  return Buffer.byteLength(text, 'utf8')
}

function hasConsistentTokenCount(
  candidate: object,
  text: string,
  declaredTokenCount: number
): boolean {
  const cached = TOKEN_ESTIMATE_CACHE.get(candidate)
  if (cached?.text === text) return declaredTokenCount === cached.tokenCount
  const tokenCount = estimateDocumentOcrTokens(text)
  TOKEN_ESTIMATE_CACHE.set(candidate, { text, tokenCount })
  return declaredTokenCount === tokenCount
}

function fitTruncatedPrefix(
  pages: ReadonlyArray<DocumentOcrSourcePage>,
  initialPageIndex: number,
  maxTokens: number,
  maxCharacters: number
): BoundedDocumentOcrText {
  for (let pageIndex = initialPageIndex; pageIndex >= 0; pageIndex -= 1) {
    const prefix = buildCompletePrefix(pages, pageIndex)
    if (!fitsDocumentBudget(prefix.text, maxTokens, maxCharacters)) continue
    const partial = fitPartialPage(prefix.text, pages[pageIndex], maxTokens, maxCharacters)
    if (!partial) continue
    return {
      text: partial.text,
      tokenCount: estimateDocumentOcrTokens(partial.text),
      pageSpans: [
        ...prefix.pageSpans,
        {
          pageNumber: pages[pageIndex].pageNumber,
          start: prefix.text.length,
          end: partial.text.length,
          complete: false
        }
      ],
      truncated: true
    }
  }

  const text = fitsDocumentBudget(PDF_OCR_TRUNCATION_MARKER, maxTokens, maxCharacters)
    ? PDF_OCR_TRUNCATION_MARKER
    : ''
  return {
    text,
    tokenCount: estimateDocumentOcrTokens(text),
    pageSpans: [],
    truncated: true
  }
}

function buildCompletePrefix(
  pages: ReadonlyArray<DocumentOcrSourcePage>,
  endExclusive: number
): { text: string; pageSpans: DocumentOcrPageSpan[] } {
  let text = ''
  const pageSpans: DocumentOcrPageSpan[] = []
  for (let index = 0; index < endExclusive; index += 1) {
    const page = pages[index]
    if (!page.complete) break
    const start = text.length
    text += formatCompletePage(page, text.length > 0)
    pageSpans.push({ pageNumber: page.pageNumber, start, end: text.length, complete: true })
  }
  return { text, pageSpans }
}

function fitPartialPage(
  prefix: string,
  page: DocumentOcrSourcePage,
  maxTokens: number,
  maxCharacters: number
): { text: string } | null {
  const buildCandidate = (retainedCharacters: number): string => {
    const retained = safePrefix(page.text, retainedCharacters).trimEnd()
    const separator = prefix.length > 0 ? '\n\n' : ''
    const markerSeparator = retained.length > 0 ? '\n\n' : ''
    return `${prefix}${separator}## Page ${page.pageNumber}\n\n${retained}${markerSeparator}${PDF_OCR_TRUNCATION_MARKER}`
  }

  const minimum = buildCandidate(0)
  if (!fitsDocumentBudget(minimum, maxTokens, maxCharacters)) return null

  let low = 0
  let high = Math.min(page.text.length, maxCharacters)
  let best = minimum
  while (low <= high) {
    const retainedCharacters = Math.floor((low + high) / 2)
    const candidate = buildCandidate(retainedCharacters)
    if (fitsDocumentBudget(candidate, maxTokens, maxCharacters)) {
      best = candidate
      low = retainedCharacters + 1
    } else {
      high = retainedCharacters - 1
    }
  }
  return { text: best }
}

function formatCompletePage(page: DocumentOcrSourcePage, hasPreviousText: boolean): string {
  if (!page.text) return ''
  const separator = hasPreviousText ? '\n\n' : ''
  return `${separator}## Page ${page.pageNumber}\n\n${page.text}`
}

function reconstructSourcePages(
  text: string,
  pageSpans: ReadonlyArray<DocumentOcrPageSpan>
): DocumentOcrSourcePage[] {
  return pageSpans.map((span) => {
    const chunk = text.slice(span.start, span.end)
    if (!chunk) return { pageNumber: span.pageNumber, text: '', complete: true }
    const prefix = `${span.start > 0 ? '\n\n' : ''}## Page ${span.pageNumber}\n\n`
    let body = chunk.slice(prefix.length)
    if (!span.complete) {
      const markerSuffix = body.endsWith(`\n\n${PDF_OCR_TRUNCATION_MARKER}`)
        ? `\n\n${PDF_OCR_TRUNCATION_MARKER}`
        : PDF_OCR_TRUNCATION_MARKER
      body = body.slice(0, -markerSuffix.length)
    }
    return { pageNumber: span.pageNumber, text: body, complete: span.complete }
  })
}

function isValidPageSpans(text: string, spans: unknown[]): spans is DocumentOcrPageSpan[] {
  return isValidDocumentOcrTextPageSpans(text, spans, {
    maxSpans: ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS
  })
}

function matchesDocumentEngineIdentity(
  engine: LightOcrEngineStatus,
  identity: DocumentOcrArtifactIdentity
): boolean {
  return (
    engine.modelBundleId === identity.bundleId &&
    engine.requestedProvider === identity.requestedBackend &&
    engine.strategy === identity.strategy &&
    sameStringArray(engine.detection.actualProviderChain, identity.detectionProviderChain) &&
    engine.detection.precision === identity.detectionPrecision &&
    sameStringArray(engine.recognition.actualProviderChain, identity.recognitionProviderChain) &&
    engine.recognition.precision === identity.recognitionPrecision
  )
}

function isCompleteRequestedScope(value: DocumentOcrArtifactValue): boolean {
  return value.artifactTermination === 'request_complete' && !value.generationOutputLimitReached
}

function retainedSpanCharacters(span: DocumentOcrPageSpan | undefined): number {
  return span ? span.end - span.start : 0
}

function fitsDocumentBudget(text: string, maxTokens: number, maxCharacters: number): boolean {
  return text.length <= maxCharacters && estimateDocumentOcrTokens(text) <= maxTokens
}

function safePrefix(text: string, length: number): string {
  let end = Math.min(Math.max(0, length), text.length)
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return text.slice(0, end)
}

function isArtifactTermination(value: unknown): value is LightOcrDocumentArtifactTermination {
  return (
    value === 'request_complete' ||
    value === 'stopped_by_output_limit' ||
    value === 'resource_limited'
  )
}

function isResourceLimit(value: unknown): value is DocumentOcrResourceLimit {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.code === 'resource_limit_exceeded' &&
    typeof candidate.message === 'string' &&
    candidate.message.length <= MAX_RESOURCE_ERROR_CHARACTERS &&
    (candidate.detail === undefined ||
      (typeof candidate.detail === 'string' &&
        candidate.detail.length <= MAX_RESOURCE_ERROR_CHARACTERS))
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
