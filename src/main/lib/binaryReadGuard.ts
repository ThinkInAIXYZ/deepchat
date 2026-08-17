import path from 'path'
import { detectMimeType, isLikelyTextFile } from '@/file/mime'

const TEXT_LIKE_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-sh'
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

const NUL_SNIFF_BYTES = 8192

/**
 * Concrete document MIME keys whose adapters extract structured text for `read`.
 * Wildcard adapter keys are excluded because findAdapterForMimeType never selects them
 * as document extractors (`text/*` is a text adapter, not a document one).
 */
export const DOCUMENT_READ_MIMES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.document.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.ms-word.template.macroEnabled.12',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-excel.template.macroEnabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-excel.addin.macroEnabled.12',
  'application/vnd.apple.numbers',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroEnabled.12',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf',
  'text/csv',
  'text/tab-separated-values'
])

export type AgentFileDecodeResult = { kind: 'text'; content: string } | { kind: 'binary' }

export function isTextLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_LIKE_MIMES.has(mimeType)
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

export function shouldRejectAgentBinaryRead(mimeType: string): boolean {
  if (mimeType.startsWith('image/')) {
    return false
  }

  return (
    ALWAYS_BINARY_MIMES.has(mimeType) ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  )
}

export function isDocumentReadMime(mimeType: string): boolean {
  return DOCUMENT_READ_MIMES.has(mimeType)
}

export function decodeAgentFileBytes(bytes: Uint8Array): AgentFileDecodeResult {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { kind: 'text', content: toBuffer(bytes.subarray(2)).toString('utf16le') }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { kind: 'text', content: new TextDecoder('utf-16be').decode(bytes.subarray(2)) }
  }
  if (bytes.subarray(0, Math.min(bytes.length, NUL_SNIFF_BYTES)).includes(0)) {
    return { kind: 'binary' }
  }
  return {
    kind: 'text',
    content: toBuffer(bytes)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
  }
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
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
