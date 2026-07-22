import type { MessageFile } from '../types/agent-interface'
import {
  ATTACHMENT_OCR_MAX_TEXT_CHARACTERS,
  ATTACHMENT_OCR_MAX_TOKENS,
  ATTACHMENT_REPRESENTATION_PREFERENCES,
  ATTACHMENT_UNAVAILABLE_REASONS,
  type AttachmentRepresentationPreference,
  type AttachmentResolvedRepresentation,
  type AttachmentUnavailableReason
} from '../types/attachment'

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

export function isImageAttachment(
  file: Pick<MessageFile, 'mimeType' | 'type' | 'path' | 'name'> | null | undefined
): boolean {
  if (!file || typeof file !== 'object') return false

  const mimeType = normalizeMimeType(file.mimeType)
  if (mimeType?.startsWith('image/')) return true
  const fileType = normalizeMimeType(file.type)
  if (fileType === 'image' || fileType?.startsWith('image/')) return true
  const candidates = [file.path, file.name].flatMap((value) =>
    typeof value === 'string' ? [value.toLowerCase()] : []
  )
  return IMAGE_FILE_EXTENSIONS.some((extension) =>
    candidates.some((candidate) => candidate.endsWith(extension))
  )
}

function normalizeMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(';')[0]?.trim().toLowerCase() || undefined
}

export function normalizeAttachmentRepresentationPreference(
  value: unknown
): AttachmentRepresentationPreference | undefined {
  return typeof value === 'string' && REPRESENTATION_PREFERENCES.has(value)
    ? (value as AttachmentRepresentationPreference)
    : undefined
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

  if (candidate.kind === 'ocr_text') {
    if (
      typeof candidate.text !== 'string' ||
      candidate.text.trim().length === 0 ||
      candidate.text.length > ATTACHMENT_OCR_MAX_TEXT_CHARACTERS ||
      !Number.isInteger(candidate.tokenCount) ||
      (candidate.tokenCount as number) < 1 ||
      (candidate.tokenCount as number) > ATTACHMENT_OCR_MAX_TOKENS ||
      typeof candidate.truncated !== 'boolean'
    ) {
      return undefined
    }

    return {
      kind: 'ocr_text',
      text: candidate.text,
      tokenCount: candidate.tokenCount as number,
      truncated: candidate.truncated
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

export function getAttachmentResolvedRepresentation(
  file: Pick<MessageFile, 'resolvedRepresentation'>
): AttachmentResolvedRepresentation | undefined {
  return normalizeAttachmentResolvedRepresentation(file.resolvedRepresentation)
}
