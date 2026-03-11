import path from 'path'
import { detectMimeType, isLikelyTextFile } from '@/presenter/filePresenter/mime'

const TEXT_LIKE_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-sh'
])

const DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet'
])

const ALWAYS_BINARY_MIMES = new Set([
  'application/zip',
  'application/x-zip',
  'application/gzip',
  'application/x-gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/wasm'
])

export function isTextLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_LIKE_MIMES.has(mimeType)
}

export function isDocumentMime(mimeType: string): boolean {
  return DOCUMENT_MIMES.has(mimeType)
}

export async function shouldRejectAcpTextRead(filePath: string): Promise<{
  reject: boolean
  mimeType: string
}> {
  const mimeType = await detectMimeType(filePath)

  if (isTextLikeMime(mimeType)) {
    return { reject: false, mimeType }
  }

  if (mimeType === 'application/octet-stream') {
    const likelyText = await isLikelyTextFile(filePath)
    return { reject: !likelyText, mimeType }
  }

  return { reject: true, mimeType }
}

export async function shouldRejectAgentBinaryRead(
  filePath: string,
  mimeType: string
): Promise<boolean> {
  if (mimeType.startsWith('image/')) {
    return false
  }

  if (isTextLikeMime(mimeType) || isDocumentMime(mimeType) || mimeType === 'text/csv') {
    return false
  }

  if (
    ALWAYS_BINARY_MIMES.has(mimeType) ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  ) {
    return true
  }

  if (mimeType === 'application/octet-stream') {
    return !(await isLikelyTextFile(filePath))
  }

  return false
}

export function buildBinaryReadGuidance(
  filePath: string,
  mimeType: string,
  mode: 'agent' | 'acp'
): string {
  const fileName = path.basename(filePath)
  const shared = `Cannot read "${fileName}" as plain text (detected MIME: ${mimeType}).`

  if (mode === 'acp') {
    return [
      shared,
      '`fs/read_text_file` only supports text files.',
      'Use OCR/image tooling for images, and convert or extract PDFs/binary formats before reading them as text.'
    ].join(' ')
  }

  return [
    shared,
    'Use image OCR/summary for images, or a dedicated conversion/extraction tool or skill script for binary formats.'
  ].join(' ')
}
