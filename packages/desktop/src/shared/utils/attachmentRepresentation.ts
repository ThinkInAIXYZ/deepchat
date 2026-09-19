import type { MessageFile } from '../types/agent-interface'
import {
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_OCR_MAX_TOKENS,
  ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS,
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  ATTACHMENT_REPRESENTATION_PREFERENCES,
  ATTACHMENT_UNAVAILABLE_REASONS,
  PDF_LOW_TEXT_PAGE_SAMPLE_LIMIT,
  PDF_PAGE_COUNT_SANITY_LIMIT,
  type AttachmentDocumentOcrSnapshot,
  type AttachmentDocumentPageSpan,
  type AttachmentRepresentationPreference,
  type AttachmentResolvedRepresentation,
  type AttachmentUnavailableReason,
  type PdfEmbeddedTextCoverage
} from '../types/attachment'
import { isValidDocumentOcrTextPageSpans } from './documentOcrText'

const REPRESENTATION_PREFERENCES = new Set<string>(ATTACHMENT_REPRESENTATION_PREFERENCES)
const UNAVAILABLE_REASONS = new Set<string>(ATTACHMENT_UNAVAILABLE_REASONS)
const IMAGE_FILE_EXTENSIONS = [
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp'
] as const
const PDF_FILE_EXTENSION = '.pdf'

export function isImageAttachment(
  file: Pick<MessageFile, 'mimeType' | 'type' | 'path' | 'name'> | null | undefined
): boolean {
  if (!file || typeof file !== 'object') return false

  const mimeType = normalizeMimeType(file.mimeType)
  if (isPdfMimeType(mimeType)) return false
  if (mimeType?.startsWith('image/')) return true
  const fileType = normalizeMimeType(file.type)
  if (isPdfMimeType(fileType) || fileType === 'pdf') return false
  if (fileType === 'image' || fileType?.startsWith('image/')) return true
  const candidates = [file.path, file.name].flatMap((value) =>
    typeof value === 'string' ? [value.toLowerCase()] : []
  )
  return IMAGE_FILE_EXTENSIONS.some((extension) =>
    candidates.some((candidate) => candidate.endsWith(extension))
  )
}

export function isPdfAttachment(
  file: Pick<MessageFile, 'mimeType' | 'type' | 'path' | 'name'> | null | undefined
): boolean {
  if (!file || typeof file !== 'object') return false
  const mimeType = normalizeMimeType(file.mimeType)
  if (isPdfMimeType(mimeType)) return true
  if (isSpecificNonPdfType(mimeType)) return false
  const fileType = normalizeMimeType(file.type)
  if (isPdfMimeType(fileType) || fileType === 'pdf') return true
  if (isSpecificNonPdfType(fileType) && fileType !== 'file') return false
  return [file.path, file.name].some(
    (value) => typeof value === 'string' && value.toLowerCase().endsWith(PDF_FILE_EXTENSION)
  )
}

export function isAttachmentPreparationCandidate(
  file: Pick<MessageFile, 'mimeType' | 'type' | 'path' | 'name'> | null | undefined
): boolean {
  return isImageAttachment(file) || isPdfAttachment(file)
}

function normalizeMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(';')[0]?.trim().toLowerCase() || undefined
}

function isPdfMimeType(value: string | undefined): boolean {
  return value === 'application/pdf' || value === 'application/x-pdf'
}

function isSpecificNonPdfType(value: string | undefined): boolean {
  return Boolean(
    value &&
    value !== 'application/octet-stream' &&
    value !== 'binary/octet-stream' &&
    value !== 'file'
  )
}

export function normalizeAttachmentRepresentationPreference(
  value: unknown
): AttachmentRepresentationPreference | undefined {
  return typeof value === 'string' && REPRESENTATION_PREFERENCES.has(value)
    ? (value as AttachmentRepresentationPreference)
    : undefined
}

export function normalizeAttachmentRepresentationPreferenceForFile(
  file: Pick<MessageFile, 'mimeType' | 'type' | 'path' | 'name'> | null | undefined,
  value: unknown
): AttachmentRepresentationPreference {
  const preference = normalizeAttachmentRepresentationPreference(value) ?? 'auto'
  if (isPdfAttachment(file)) {
    return preference === 'embedded_text' || preference === 'ocr_text' ? preference : 'auto'
  }
  if (isImageAttachment(file)) {
    return preference === 'image' || preference === 'ocr_text' ? preference : 'auto'
  }
  return 'auto'
}

export function normalizeAttachmentResolvedRepresentation(
  value: unknown
): AttachmentResolvedRepresentation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'image') {
    return { kind: 'image' }
  }

  if (candidate.kind === 'embedded_text') {
    return { kind: 'embedded_text' }
  }

  if (candidate.kind === 'ocr_text') {
    const hasDocumentSnapshot = candidate.document !== undefined
    const document = !hasDocumentSnapshot
      ? undefined
      : normalizeAttachmentDocumentOcrSnapshot(candidate.document, candidate.text)
    const maxTokens = document ? ATTACHMENT_PDF_OCR_MAX_TOKENS : ATTACHMENT_OCR_MAX_TOKENS
    if (
      typeof candidate.text !== 'string' ||
      candidate.text.trim().length === 0 ||
      candidate.text.length > ATTACHMENT_OCR_MAX_TEXT_CHARACTERS ||
      !Number.isInteger(candidate.tokenCount) ||
      (candidate.tokenCount as number) < 1 ||
      (candidate.tokenCount as number) > maxTokens ||
      typeof candidate.truncated !== 'boolean' ||
      (hasDocumentSnapshot && !document) ||
      (document &&
        candidate.truncated !==
          (document.generationOutputLimitReached ||
            document.artifactTermination === 'resource_limited'))
    ) {
      return hasDocumentSnapshot
        ? { kind: 'unavailable', reason: 'invalid_attachment_snapshot' }
        : undefined
    }

    return {
      kind: 'ocr_text',
      text: candidate.text,
      tokenCount: candidate.tokenCount as number,
      truncated: candidate.truncated,
      ...(document ? { document } : {})
    }
  }

  if (
    candidate.kind === 'unavailable' &&
    typeof candidate.reason === 'string' &&
    UNAVAILABLE_REASONS.has(candidate.reason)
  ) {
    return {
      kind: 'unavailable',
      reason: candidate.reason as AttachmentUnavailableReason
    }
  }

  return undefined
}

export function normalizePdfEmbeddedTextCoverage(
  value: unknown
): PdfEmbeddedTextCoverage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.routingRevision !== 'string' ||
    candidate.routingRevision.length === 0 ||
    candidate.routingRevision.length > 128 ||
    !isIntegerInRange(candidate.pageCount, 1, PDF_PAGE_COUNT_SANITY_LIMIT) ||
    !isIntegerInRange(candidate.substantivePageCount, 0, candidate.pageCount as number) ||
    !isIntegerInRange(candidate.lowTextPageCount, 0, candidate.pageCount as number) ||
    (candidate.substantivePageCount as number) + (candidate.lowTextPageCount as number) !==
      candidate.pageCount ||
    !Array.isArray(candidate.lowTextPageSamples) ||
    candidate.lowTextPageSamples.length > PDF_LOW_TEXT_PAGE_SAMPLE_LIMIT ||
    candidate.lowTextPageSamples.length > (candidate.lowTextPageCount as number) ||
    typeof candidate.hasEmbeddedText !== 'boolean' ||
    ((candidate.substantivePageCount as number) > 0 && !candidate.hasEmbeddedText)
  ) {
    return undefined
  }

  const samples = candidate.lowTextPageSamples
  if (
    !samples.every(
      (pageNumber, index) =>
        isIntegerInRange(pageNumber, 1, candidate.pageCount as number) &&
        (index === 0 || pageNumber > (samples[index - 1] as number))
    )
  ) {
    return undefined
  }
  return {
    routingRevision: candidate.routingRevision,
    pageCount: candidate.pageCount as number,
    substantivePageCount: candidate.substantivePageCount as number,
    lowTextPageCount: candidate.lowTextPageCount as number,
    lowTextPageSamples: [...(samples as number[])],
    hasEmbeddedText: candidate.hasEmbeddedText
  }
}

export function getAttachmentResolvedRepresentation(
  file: Pick<MessageFile, 'resolvedRepresentation'>
): AttachmentResolvedRepresentation | undefined {
  return normalizeAttachmentResolvedRepresentation(file.resolvedRepresentation)
}

export function getAttachmentSearchableText(file: unknown): string {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return ''
  const candidate = file as Record<string, unknown>
  const resolved = normalizeAttachmentResolvedRepresentation(candidate.resolvedRepresentation)
  if (resolved?.kind === 'ocr_text') return resolved.text
  if (
    resolved?.kind === 'embedded_text' &&
    typeof candidate.content === 'string' &&
    isPdfAttachment({
      name: typeof candidate.name === 'string' ? candidate.name : '',
      path: typeof candidate.path === 'string' ? candidate.path : '',
      type: typeof candidate.type === 'string' ? candidate.type : undefined,
      mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : undefined
    })
  ) {
    return candidate.content
  }
  return ''
}

function normalizeAttachmentDocumentOcrSnapshot(
  value: unknown,
  text: unknown
): AttachmentDocumentOcrSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof text !== 'string') {
    return undefined
  }
  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.pageSpans) ||
    candidate.pageSpans.length === 0 ||
    candidate.pageSpans.length > ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS ||
    !isValidDocumentOcrTextPageSpans(text, candidate.pageSpans, {
      maxSpans: ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS
    }) ||
    (candidate.sourcePageCountHint !== undefined &&
      !isIntegerInRange(candidate.sourcePageCountHint, 1, PDF_PAGE_COUNT_SANITY_LIMIT)) ||
    !isIntegerInRange(candidate.includedThroughPage, 1, PDF_PAGE_COUNT_SANITY_LIMIT) ||
    typeof candidate.includedThroughPageComplete !== 'boolean' ||
    (candidate.artifactTermination !== 'request_complete' &&
      candidate.artifactTermination !== 'stopped_by_output_limit' &&
      candidate.artifactTermination !== 'resource_limited') ||
    typeof candidate.generationOutputLimitReached !== 'boolean'
  ) {
    return undefined
  }

  const pageSpans = candidate.pageSpans as AttachmentDocumentPageSpan[]
  const lastSpan = pageSpans.at(-1)!
  if (
    candidate.includedThroughPage !== lastSpan.pageNumber ||
    candidate.includedThroughPageComplete !== lastSpan.complete ||
    (candidate.generationOutputLimitReached && lastSpan.complete) ||
    (candidate.artifactTermination === 'stopped_by_output_limit' &&
      !candidate.generationOutputLimitReached)
  ) {
    return undefined
  }
  const embeddedTextCoverage =
    candidate.embeddedTextCoverage === undefined
      ? undefined
      : normalizePdfEmbeddedTextCoverage(candidate.embeddedTextCoverage)
  if (candidate.embeddedTextCoverage !== undefined && !embeddedTextCoverage) return undefined

  return {
    pageSpans: pageSpans.map((span) => ({
      pageNumber: span.pageNumber,
      start: span.start,
      end: span.end,
      complete: span.complete
    })),
    ...(candidate.sourcePageCountHint
      ? { sourcePageCountHint: candidate.sourcePageCountHint as number }
      : {}),
    includedThroughPage: candidate.includedThroughPage as number,
    includedThroughPageComplete: candidate.includedThroughPageComplete,
    artifactTermination: candidate.artifactTermination,
    generationOutputLimitReached: candidate.generationOutputLimitReached,
    ...(embeddedTextCoverage ? { embeddedTextCoverage } : {})
  }
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}
