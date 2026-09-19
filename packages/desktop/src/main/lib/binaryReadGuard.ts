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

const AGENT_ENCODING_HINT_MIMES = new Set([
  'application/toml',
  'application/sql',
  'application/rls-services+xml',
  'application/x-httpd-php',
  'application/node',
  'application/x-ipynb+json',
  'application/x-yaml',
  'application/yaml'
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
const UTF16BE_DECODER = new TextDecoder('utf-16be')

export const AGENT_RAW_READ_MAX_BYTES = 10 * 1024 * 1024
export const DEFAULT_DOCUMENT_READ_MAX_BYTES = 30 * 1024 * 1024

type AgentFileDecodeResult = { kind: 'text'; content: string } | { kind: 'binary' }

function isTextLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_LIKE_MIMES.has(mimeType)
}

function shouldHintUtf16WithoutBom(mimeType: string): boolean {
  return isTextLikeMime(mimeType) || AGENT_ENCODING_HINT_MIMES.has(mimeType)
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

export function decodeAgentFileBytes(bytes: Buffer): AgentFileDecodeResult {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    // Node Buffer has utf16le but no utf16be.
    return { kind: 'text', content: bytes.subarray(2).toString('utf16le') }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { kind: 'text', content: UTF16BE_DECODER.decode(bytes.subarray(2)) }
  }
  if (bytes.subarray(0, NUL_SNIFF_BYTES).includes(0)) {
    return { kind: 'binary' }
  }
  return { kind: 'text', content: bytes.toString('utf8').replace(/^\uFEFF/, '') }
}

export function paginateReadContent(
  pathLabel: string,
  fullContent: string,
  offset: number | undefined,
  limit: number | undefined,
  autoTruncateChars: number,
  byteWindow?: { readBytes: number; totalBytes: number }
): string {
  const start = Math.max(0, offset ?? 0)
  const totalLength = fullContent.length

  let effectiveLimit = limit
  let autoTruncated = false
  if (effectiveLimit === undefined && totalLength - start > autoTruncateChars) {
    effectiveLimit = autoTruncateChars
    autoTruncated = true
  }

  const content =
    effectiveLimit !== undefined
      ? fullContent.slice(start, start + effectiveLimit)
      : fullContent.slice(start)
  const endOffset = start + content.length
  const truncatedByBytes = byteWindow !== undefined && byteWindow.readBytes < byteWindow.totalBytes
  const needsHeader = start > 0 || limit !== undefined || autoTruncated || truncatedByBytes

  if (!needsHeader) {
    return `${pathLabel}:\n${content}\n`
  }

  const parts: string[] = []
  if (truncatedByBytes && byteWindow) {
    parts.push(`first ${byteWindow.readBytes} of ${byteWindow.totalBytes} bytes`)
  }
  if (start > 0 || limit !== undefined || autoTruncated) {
    parts.push(`chars ${start}-${endOffset} of ${totalLength}`)
  }
  let header = `${pathLabel} [${parts.join('; ')}]`
  if (autoTruncated) {
    header += ' (auto-truncated, use offset/limit to read more)'
  }
  return `${header}:\n${content}\n`
}

export function buildOversizedReadGuidance(
  filePath: string,
  fileSize: number,
  limitBytes: number
): string {
  return `File too large: "${path.basename(filePath)}" is ${fileSize} bytes (limit ${limitBytes}).`
}

export function buildEmptyDocumentReadGuidance(
  filePath: string,
  mimeType: string,
  fileSize: number,
  maxFileSize: number
): string {
  return [
    `Cannot extract text from "${path.basename(filePath)}" (detected MIME: ${mimeType}).`,
    'The file may be damaged or contain no extractable text layer.',
    `File size: ${fileSize} bytes (document limit ${maxFileSize} bytes).`
  ].join(' ')
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

  if (shouldHintUtf16WithoutBom(mimeType)) {
    return [
      shared,
      'The file contains NUL bytes and may be UTF-16 without a BOM. Convert it to UTF-8 and retry.'
    ].join(' ')
  }

  return [
    shared,
    'Use image OCR/summary for images, or a dedicated conversion/extraction tool or skill script for binary formats.'
  ].join(' ')
}
