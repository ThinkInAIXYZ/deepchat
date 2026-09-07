import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ImagePreprocessingError,
  preprocessImageForOcr,
  readImmutableImageSnapshot,
  sniffOcrImageMimeType
} from '../../../src/main/ocr/imagePreprocessor'

function createTestBmp(options: { bitsPerPixel?: 24 | 32; topDown?: boolean } = {}): Buffer {
  const bitsPerPixel = options.bitsPerPixel ?? 24
  const topDown = options.topDown ?? false
  const width = 1
  const height = 2
  const bytesPerPixel = bitsPerPixel / 8
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4
  const pixelBytes = rowStride * height
  const bitmap = Buffer.alloc(54 + pixelBytes)
  bitmap.write('BM', 0, 'ascii')
  bitmap.writeUInt32LE(bitmap.byteLength, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(topDown ? -height : height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(bitsPerPixel, 28)
  bitmap.writeUInt32LE(pixelBytes, 34)

  const visualRows = [
    [255, 0, 0],
    [0, 0, 255]
  ]
  for (let fileRow = 0; fileRow < height; fileRow += 1) {
    const visualRow = topDown ? fileRow : height - fileRow - 1
    const [red, green, blue] = visualRows[visualRow]
    const offset = 54 + fileRow * rowStride
    bitmap[offset] = blue
    bitmap[offset + 1] = green
    bitmap[offset + 2] = red
    if (bytesPerPixel === 4) bitmap[offset + 3] = 0
  }
  return bitmap
}

describe('imagePreprocessor', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-ocr-preprocess-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('hashes and preprocesses the same immutable source bytes', async () => {
    const sourcePath = path.join(tempDir, 'mutable-image.bin')
    const original = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#ff0000' }
    })
      .png()
      .toBuffer()
    const replacement = await sharp({
      create: { width: 8, height: 6, channels: 3, background: '#0000ff' }
    })
      .png()
      .toBuffer()
    await writeFile(sourcePath, original)

    const snapshot = await readImmutableImageSnapshot({
      filePath: sourcePath,
      maxFileSize: 1024 * 1024
    })
    await writeFile(sourcePath, replacement)
    const preprocessed = await preprocessImageForOcr(snapshot)

    expect(snapshot.sourceSha256).toBe(createHash('sha256').update(original).digest('hex'))
    expect(preprocessed).toMatchObject({
      mimeType: 'image/png',
      width: 4,
      height: 3,
      strategy: 'bounded-960'
    })
  })

  it('applies EXIF rotation, flattens transparency, and bounds the normalized image', async () => {
    const oriented = await sharp({
      create: { width: 2, height: 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const orientedResult = await preprocessImageForOcr({
      bytes: oriented,
      sourceSha256: 'oriented'
    })
    expect(orientedResult).toMatchObject({ width: 3, height: 2 })
    const transparent = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .png()
      .toBuffer()
    const transparentResult = await preprocessImageForOcr({
      bytes: transparent,
      sourceSha256: 'transparent'
    })
    const { data: flattenedPixel, info: flattenedInfo } = await sharp(transparentResult.encoded)
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(flattenedInfo.channels).toBe(3)
    expect([...flattenedPixel]).toEqual([255, 255, 255])

    const wide = await sharp({
      create: { width: 5_000, height: 10, channels: 3, background: '#ffffff' }
    })
      .png()
      .toBuffer()
    const wideResult = await preprocessImageForOcr({ bytes: wide, sourceSha256: 'wide' })
    expect(wideResult.width).toBe(4_096)
    expect(wideResult.strategy).toBe('tiled-v1')
  })

  it('decodes every supported v1 format and takes the first animated or multi-page frame', async () => {
    const source = sharp({
      create: { width: 2, height: 2, channels: 3, background: '#22aa44' }
    })
    const fixtures = await Promise.all([
      source
        .clone()
        .jpeg()
        .toBuffer()
        .then((bytes) => ['image/jpeg', bytes] as const),
      source
        .clone()
        .png()
        .toBuffer()
        .then((bytes) => ['image/png', bytes] as const),
      source
        .clone()
        .webp()
        .toBuffer()
        .then((bytes) => ['image/webp', bytes] as const),
      source
        .clone()
        .tiff()
        .toBuffer()
        .then((bytes) => ['image/tiff', bytes] as const),
      source
        .clone()
        .gif()
        .toBuffer()
        .then((bytes) => ['image/gif', bytes] as const),
      Promise.resolve(['image/bmp', createTestBmp()] as const)
    ])

    for (const [mimeType, bytes] of fixtures) {
      await expect(preprocessImageForOcr({ bytes, sourceSha256: mimeType })).resolves.toMatchObject(
        { mimeType }
      )
    }

    const multiPageGif = await sharp({
      create: {
        width: 2,
        height: 4,
        pageHeight: 2,
        channels: 3,
        background: '#ffffff'
      }
    })
      .gif({ delay: [10, 10], loop: 0 })
      .toBuffer()
    const firstFrame = await preprocessImageForOcr({
      bytes: multiPageGif,
      sourceSha256: 'animated'
    })
    expect(firstFrame).toMatchObject({ width: 2, height: 2, mimeType: 'image/gif' })
  })

  it.each([
    [24, false],
    [24, true],
    [32, false],
    [32, true]
  ] as const)('decodes %i-bit BMP with topDown=%s', async (bitsPerPixel, topDown) => {
    const result = await preprocessImageForOcr({
      bytes: createTestBmp({ bitsPerPixel, topDown }),
      sourceSha256: `bmp-${bitsPerPixel}-${topDown}`
    })
    const pixels = await sharp(result.encoded).removeAlpha().raw().toBuffer()

    expect(result).toMatchObject({ mimeType: 'image/bmp', width: 1, height: 2 })
    expect([...pixels]).toEqual([255, 0, 0, 0, 0, 255])
  })

  it.each([
    ['indexed', 8, 0],
    ['RLE', 24, 1],
    ['bitfields', 32, 3]
  ])('rejects unsupported %s BMP variants', async (_name, bitsPerPixel, compression) => {
    const bitmap = createTestBmp()
    bitmap.writeUInt16LE(bitsPerPixel, 28)
    bitmap.writeUInt32LE(compression, 30)

    await expect(
      preprocessImageForOcr({ bytes: bitmap, sourceSha256: 'unsupported-bmp' })
    ).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it.each([
    [
      'pixel offset',
      () => {
        const bitmap = createTestBmp()
        bitmap.writeUInt32LE(53, 10)
        return bitmap
      }
    ],
    ['truncated pixels', () => createTestBmp().subarray(0, -1)],
    [
      'declared pixel size',
      () => {
        const bitmap = createTestBmp()
        bitmap.writeUInt32LE(1, 34)
        return bitmap
      }
    ]
  ])('rejects malformed BMP %s', async (_name, createBitmap) => {
    await expect(
      preprocessImageForOcr({ bytes: createBitmap(), sourceSha256: 'malformed-bmp' })
    ).rejects.toMatchObject({ code: 'decode_failed' })
  })

  it('sniffs supported formats from bytes instead of the supplied file name', () => {
    expect(sniffOcrImageMimeType(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(sniffOcrImageMimeType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffOcrImageMimeType(Buffer.from('BMfixture'))).toBe('image/bmp')
    expect(sniffOcrImageMimeType(Buffer.from('II*\0fixture'))).toBe('image/tiff')
    expect(sniffOcrImageMimeType(Buffer.from('II+\0fixture'))).toBe('image/tiff')
    expect(sniffOcrImageMimeType(Buffer.from('RIFFxxxxWEBP'))).toBe('image/webp')
  })

  it.each([
    ['SVG', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['AVIF', Buffer.from('\0\0\0\u0018ftypavif\0\0\0\0avifmif1')],
    ['unknown', Buffer.from('not-an-image')]
  ])('rejects unsupported %s bytes explicitly', async (_name, bytes) => {
    await expect(
      preprocessImageForOcr({ bytes, sourceSha256: 'unsupported' })
    ).rejects.toMatchObject({ code: 'unsupported_format' })
  })

  it('enforces source byte and decoded side limits', async () => {
    const sourcePath = path.join(tempDir, 'oversized-source.png')
    await writeFile(sourcePath, Buffer.alloc(16, 1))
    await expect(
      readImmutableImageSnapshot({ filePath: sourcePath, maxFileSize: 8 })
    ).rejects.toMatchObject({ code: 'input_too_large' })

    const tooWide = await sharp({
      create: { width: 16_385, height: 1, channels: 3, background: '#ffffff' }
    })
      .png()
      .toBuffer()
    await expect(
      preprocessImageForOcr({ bytes: tooWide, sourceSha256: 'too-wide' })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ImagePreprocessingError &&
        (error.code === 'image_dimensions_exceeded' || error.code === 'decode_failed')
    )
  })
})
