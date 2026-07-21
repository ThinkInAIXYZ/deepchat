import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

import sharp from 'sharp'

import type { LightOcrRecognitionStrategy } from './lightOcrProtocol'

export const OCR_MAX_SOURCE_BYTES = 50 * 1024 * 1024
export const OCR_MAX_DECODED_PIXELS = 50_000_000
export const OCR_MAX_IMAGE_SIDE = 16_384
export const OCR_MAX_NORMALIZED_SIDE = 4_096
export const OCR_BOUNDED_STRATEGY_THRESHOLD = 1_600
export const OCR_PREPROCESSING_REVISION = [
  'sharp-png-v1',
  `sharp=${sharp.versions.sharp}`,
  `vips=${sharp.versions.vips}`,
  'bmp=bi-rgb-24-32-v1'
].join(';')

const READ_CHUNK_BYTES = 1024 * 1024
const BMP_FILE_HEADER_BYTES = 14
const BMP_INFO_HEADER_BYTES = 40
const BMP_PIXEL_OFFSET_MINIMUM = BMP_FILE_HEADER_BYTES + BMP_INFO_HEADER_BYTES
const BMP_ROWS_PER_YIELD = 64

export type SupportedOcrImageMimeType =
  | 'image/bmp'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/tiff'
  | 'image/webp'

export type ImagePreprocessingErrorCode =
  | 'cancelled'
  | 'decode_failed'
  | 'empty_input'
  | 'image_dimensions_exceeded'
  | 'input_too_large'
  | 'invalid_image_dimensions'
  | 'unsupported_format'

export class ImagePreprocessingError extends Error {
  constructor(
    readonly code: ImagePreprocessingErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ImagePreprocessingError'
  }
}

export interface ImmutableImageSnapshot {
  bytes: Buffer
  sourceSha256: string
}

export interface PreprocessedOcrImage {
  encoded: Buffer
  mimeType: SupportedOcrImageMimeType
  width: number
  height: number
  strategy: LightOcrRecognitionStrategy
  preprocessingRevision: string
}

export async function readImmutableImageSnapshot(input: {
  filePath: string
  maxFileSize: number
  signal?: AbortSignal
}): Promise<ImmutableImageSnapshot> {
  const byteLimit = normalizeSourceByteLimit(input.maxFileSize)
  throwIfAborted(input.signal)
  const handle = await open(input.filePath, 'r')
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) {
      throw new ImagePreprocessingError('decode_failed', 'OCR input must be a regular file')
    }
    if (fileStat.size > byteLimit) throwInputTooLarge()

    const chunks: Buffer[] = []
    let bytesReadTotal = 0
    while (true) {
      throwIfAborted(input.signal)
      const readSize = Math.min(READ_CHUNK_BYTES, byteLimit + 1 - bytesReadTotal)
      const chunk = Buffer.allocUnsafe(readSize)
      const { bytesRead } = await handle.read(chunk, 0, readSize, bytesReadTotal)
      if (bytesRead === 0) break
      bytesReadTotal += bytesRead
      if (bytesReadTotal > byteLimit) throwInputTooLarge()
      chunks.push(chunk.subarray(0, bytesRead))
    }

    if (bytesReadTotal === 0) {
      throw new ImagePreprocessingError('empty_input', 'OCR input is empty')
    }
    const bytes = Buffer.concat(chunks, bytesReadTotal)
    return {
      bytes,
      sourceSha256: createHash('sha256').update(bytes).digest('hex')
    }
  } finally {
    await handle.close()
  }
}

export async function preprocessImageForOcr(
  snapshot: ImmutableImageSnapshot,
  signal?: AbortSignal
): Promise<PreprocessedOcrImage> {
  throwIfAborted(signal)
  const mimeType = sniffOcrImageMimeType(snapshot.bytes)

  try {
    const source = await createSharpSource(snapshot.bytes, mimeType, signal)
    const metadata = await source.metadata()
    const width = metadata.width
    const height = metadata.pageHeight ?? metadata.height
    assertImageDimensions(width, height)
    if (mimeType !== 'image/bmp') assertDecodedFormat(metadata.format, mimeType)
    throwIfAborted(signal)

    const { data, info } = await source
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(OCR_MAX_NORMALIZED_SIDE, OCR_MAX_NORMALIZED_SIDE, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ adaptiveFiltering: true, compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true })
    throwIfAborted(signal)
    assertImageDimensions(info.width, info.height)

    const longestSide = Math.max(info.width, info.height)
    return {
      encoded: data,
      mimeType,
      width: info.width,
      height: info.height,
      strategy: longestSide <= OCR_BOUNDED_STRATEGY_THRESHOLD ? 'bounded-960' : 'tiled-v1',
      preprocessingRevision: OCR_PREPROCESSING_REVISION
    }
  } catch (error) {
    if (error instanceof ImagePreprocessingError) throw error
    throw new ImagePreprocessingError('decode_failed', 'OCR image decoding failed', {
      cause: error
    })
  }
}

async function createSharpSource(
  bytes: Buffer,
  mimeType: SupportedOcrImageMimeType,
  signal?: AbortSignal
): Promise<sharp.Sharp> {
  if (mimeType === 'image/bmp') {
    const decoded = await decodeBmpToRgba(bytes, signal)
    return sharp(decoded.rgba, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
      limitInputPixels: OCR_MAX_DECODED_PIXELS,
      sequentialRead: true
    })
  }
  return sharp(bytes, {
    animated: false,
    failOn: 'error',
    limitInputPixels: OCR_MAX_DECODED_PIXELS,
    page: 0,
    pages: 1,
    sequentialRead: true
  })
}

interface DecodedBmp {
  rgba: Buffer
  width: number
  height: number
}

interface ValidatedBmpHeader {
  bitsPerPixel: 24 | 32
  height: number
  pixelOffset: number
  rowStride: number
  topDown: boolean
  width: number
}

async function decodeBmpToRgba(bytes: Buffer, signal?: AbortSignal): Promise<DecodedBmp> {
  const header = parseAndValidateBmpHeader(bytes)
  const rgba = Buffer.allocUnsafe(header.width * header.height * 4)
  const sourcePixelBytes = header.bitsPerPixel / 8

  for (let outputRow = 0; outputRow < header.height; outputRow += 1) {
    if (outputRow % BMP_ROWS_PER_YIELD === 0) {
      throwIfAborted(signal)
      if (outputRow > 0) {
        await yieldToEventLoop()
        throwIfAborted(signal)
      }
    }
    const sourceRow = header.topDown ? outputRow : header.height - outputRow - 1
    const sourceRowOffset = header.pixelOffset + sourceRow * header.rowStride
    const outputRowOffset = outputRow * header.width * 4

    for (let column = 0; column < header.width; column += 1) {
      const sourceOffset = sourceRowOffset + column * sourcePixelBytes
      const outputOffset = outputRowOffset + column * 4
      rgba[outputOffset] = bytes[sourceOffset + 2]
      rgba[outputOffset + 1] = bytes[sourceOffset + 1]
      rgba[outputOffset + 2] = bytes[sourceOffset]
      // BI_RGB with a 40-byte info header does not define an alpha channel.
      rgba[outputOffset + 3] = 255
    }
  }
  throwIfAborted(signal)
  return { rgba, width: header.width, height: header.height }
}

function parseAndValidateBmpHeader(bytes: Buffer): ValidatedBmpHeader {
  if (bytes.byteLength < BMP_PIXEL_OFFSET_MINIMUM) {
    throw new ImagePreprocessingError('decode_failed', 'BMP header is truncated')
  }
  const fileSize = bytes.readUInt32LE(2)
  const pixelOffset = bytes.readUInt32LE(10)
  const dibHeaderSize = bytes.readUInt32LE(14)
  const width = bytes.readInt32LE(18)
  const signedHeight = bytes.readInt32LE(22)
  const height = Math.abs(signedHeight)
  const planes = bytes.readUInt16LE(26)
  const bitsPerPixel = bytes.readUInt16LE(28)
  const compression = bytes.readUInt32LE(30)
  const rawSize = bytes.readUInt32LE(34)

  assertImageDimensions(width, height)
  if (
    dibHeaderSize !== BMP_INFO_HEADER_BYTES ||
    planes !== 1 ||
    (bitsPerPixel !== 24 && bitsPerPixel !== 32) ||
    signedHeight === -2_147_483_648
  ) {
    throw new ImagePreprocessingError(
      'unsupported_format',
      'Only uncompressed 24-bit and 32-bit BMP images are supported'
    )
  }
  if (compression !== 0) {
    throw new ImagePreprocessingError(
      'unsupported_format',
      'Compressed and bitfield BMP images are not supported'
    )
  }

  if (pixelOffset < BMP_PIXEL_OFFSET_MINIMUM || pixelOffset > bytes.byteLength) {
    throw new ImagePreprocessingError('decode_failed', 'BMP pixel offset is invalid')
  }
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4
  const expectedPixelBytes = rowStride * height
  const pixelEnd = pixelOffset + expectedPixelBytes
  if (
    pixelEnd > bytes.byteLength ||
    (fileSize !== 0 && (fileSize > bytes.byteLength || fileSize < pixelEnd))
  ) {
    throw new ImagePreprocessingError('decode_failed', 'BMP pixel data is truncated')
  }
  if (rawSize !== 0 && rawSize !== expectedPixelBytes) {
    throw new ImagePreprocessingError('decode_failed', 'BMP pixel size is invalid')
  }
  return {
    bitsPerPixel,
    height,
    pixelOffset,
    rowStride,
    topDown: signedHeight < 0,
    width
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export function sniffOcrImageMimeType(bytes: Uint8Array): SupportedOcrImageMimeType {
  if (bytes.byteLength === 0) {
    throw new ImagePreprocessingError('empty_input', 'OCR input is empty')
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (
    hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ||
    hasPrefix(bytes, [0x49, 0x49, 0x2b, 0x00]) ||
    hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2b])
  ) {
    return 'image/tiff'
  }
  if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp'

  if (isIsoBaseMediaImage(bytes) || looksLikeSvg(bytes)) {
    throw new ImagePreprocessingError(
      'unsupported_format',
      'This image format is not supported for OCR'
    )
  }
  throw new ImagePreprocessingError('unsupported_format', 'Unsupported OCR image format')
}

function normalizeSourceByteLimit(maxFileSize: number): number {
  if (!Number.isFinite(maxFileSize) || maxFileSize <= 0) {
    throw new ImagePreprocessingError(
      'input_too_large',
      'The configured OCR file size limit is invalid'
    )
  }
  return Math.min(Math.floor(maxFileSize), OCR_MAX_SOURCE_BYTES)
}

function assertImageDimensions(width?: number, height?: number): void {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ImagePreprocessingError(
      'invalid_image_dimensions',
      'OCR image dimensions are invalid'
    )
  }
  if (
    width > OCR_MAX_IMAGE_SIDE ||
    height > OCR_MAX_IMAGE_SIDE ||
    BigInt(width) * BigInt(height) > BigInt(OCR_MAX_DECODED_PIXELS)
  ) {
    throw new ImagePreprocessingError(
      'image_dimensions_exceeded',
      'OCR image exceeds the decoded dimension limit'
    )
  }
}

function assertDecodedFormat(
  sharpFormat: string | undefined,
  mimeType: SupportedOcrImageMimeType
): void {
  const expectedFormat: Record<SupportedOcrImageMimeType, string> = {
    'image/bmp': 'bmp',
    'image/gif': 'gif',
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/tiff': 'tiff',
    'image/webp': 'webp'
  }
  if (sharpFormat !== expectedFormat[mimeType]) {
    throw new ImagePreprocessingError(
      'unsupported_format',
      'OCR image signature does not match the decoded format'
    )
  }
}

function throwInputTooLarge(): never {
  throw new ImagePreprocessingError('input_too_large', 'OCR input exceeds the source byte limit')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImagePreprocessingError('cancelled', 'OCR image processing was cancelled')
  }
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.byteLength < offset + length) return ''
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString('ascii')
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024)))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)?<svg\b/i.test(prefix)
}

function isIsoBaseMediaImage(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12 || ascii(bytes, 4, 4) !== 'ftyp') return false
  const brands = Buffer.from(bytes.subarray(8, Math.min(bytes.byteLength, 64))).toString('ascii')
  return /(?:avif|avis|heic|heix|hevc|hevx|mif1|msf1)/.test(brands)
}
