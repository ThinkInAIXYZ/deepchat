import { describe, expect, it } from 'vitest'
import {
  decodeAgentFileBytes,
  DOCUMENT_READ_MIMES,
  isDocumentReadMime,
  shouldRejectAgentBinaryRead
} from '../../../src/main/lib/binaryReadGuard'
import { CsvFileAdapter } from '../../../src/main/file/adapters/CsvFileAdapter'
import { DocFileAdapter } from '../../../src/main/file/adapters/DocFileAdapter'
import { ExcelFileAdapter } from '../../../src/main/file/adapters/ExcelFileAdapter'
import { OpenDocumentFileAdapter } from '../../../src/main/file/adapters/OpenDocumentFileAdapter'
import { PdfFileAdapter } from '../../../src/main/file/adapters/PdfFileAdapter'
import { PptFileAdapter } from '../../../src/main/file/adapters/PptFileAdapter'
import { RtfFileAdapter } from '../../../src/main/file/adapters/RtfFileAdapter'
import { getMimeTypeAdapterMap } from '../../../src/main/file/mime'

const DOCUMENT_ADAPTERS = new Set([
  CsvFileAdapter,
  DocFileAdapter,
  ExcelFileAdapter,
  OpenDocumentFileAdapter,
  PdfFileAdapter,
  PptFileAdapter,
  RtfFileAdapter
])

describe('binaryReadGuard', () => {
  it('allows application/octet-stream without binary sniffing', () => {
    expect(shouldRejectAgentBinaryRead('application/octet-stream')).toBe(false)
  })

  it.each(['application/zip', 'application/wasm', 'audio/mpeg', 'video/mp4'])(
    'still rejects known binary MIME %s',
    (mimeType) => {
      expect(shouldRejectAgentBinaryRead(mimeType)).toBe(true)
    }
  )

  it('keeps images available for vision reads', () => {
    expect(shouldRejectAgentBinaryRead('image/png')).toBe(false)
  })

  it('matches concrete document adapter MIME keys and ignores wildcards', () => {
    const expected = [...getMimeTypeAdapterMap().entries()]
      .filter(([key, adapter]) => DOCUMENT_ADAPTERS.has(adapter) && !key.includes('*'))
      .map(([key]) => key)
      .sort()

    expect([...DOCUMENT_READ_MIMES].sort()).toEqual(expected)
    expect(expected).toHaveLength(37)
    expect(isDocumentReadMime('application/toml')).toBe(false)
    expect(isDocumentReadMime('text/*')).toBe(false)
    expect(isDocumentReadMime('application/vnd.oasis.opendocument.text')).toBe(true)
    expect(isDocumentReadMime('text/tab-separated-values')).toBe(true)
  })

  it.each([
    [
      'UTF-16LE BOM',
      Buffer.from('\uFEFFdiff --git a/file.ts b/file.ts\n+const value = 1\n', 'utf16le'),
      'diff --git a/file.ts b/file.ts'
    ],
    [
      'UTF-16BE BOM',
      Buffer.from('\uFEFFdiff --git a/file.ts b/file.ts\n+const value = 1\n', 'utf16le').swap16(),
      'diff --git a/file.ts b/file.ts'
    ],
    [
      'UTF-8 BOM',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('diff --git a/file.ts b/file.ts\n+const value = 1\n', 'utf8')
      ]),
      'diff --git a/file.ts b/file.ts'
    ]
  ])('decodes %s as text without a BOM mark', (_label, bytes, snippet) => {
    const decoded = decodeAgentFileBytes(bytes)
    expect(decoded).toEqual({ kind: 'text', content: expect.stringContaining(snippet) })
    if (decoded.kind === 'text') {
      expect(decoded.content).not.toContain('\uFEFF')
      expect(decoded.content).not.toContain('\u0000')
    }
  })

  it('treats a NUL in the first 8KB without a BOM as binary', () => {
    expect(decodeAgentFileBytes(Buffer.from([0x68, 0x69, 0x00, 0x21]))).toEqual({ kind: 'binary' })
  })

  it('ignores a NUL past the 8KB sniff window', () => {
    const bytes = Buffer.alloc(8193, 0x61)
    bytes[8192] = 0
    expect(decodeAgentFileBytes(bytes)).toEqual({
      kind: 'text',
      content: 'a'.repeat(8192) + '\u0000'
    })
  })

  it('keeps GBK-like bytes as relaxed UTF-8 text', () => {
    const decoded = decodeAgentFileBytes(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    expect(decoded.kind).toBe('text')
  })

  it('decodes an empty buffer as empty text', () => {
    expect(decodeAgentFileBytes(Buffer.alloc(0))).toEqual({ kind: 'text', content: '' })
  })
})
