import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectMimeType,
  getMimeTypeAdapterMap
} from '../../../../src/main/presenter/filePresenter/mime'
import { CsvFileAdapter } from '../../../../src/main/presenter/filePresenter/CsvFileAdapter'
import { DocFileAdapter } from '../../../../src/main/presenter/filePresenter/DocFileAdapter'
import { ExcelFileAdapter } from '../../../../src/main/presenter/filePresenter/ExcelFileAdapter'
import { ImageFileAdapter } from '../../../../src/main/presenter/filePresenter/ImageFileAdapter'
import { OpenDocumentFileAdapter } from '../../../../src/main/presenter/filePresenter/OpenDocumentFileAdapter'
import { PptFileAdapter } from '../../../../src/main/presenter/filePresenter/PptFileAdapter'
import { RtfFileAdapter } from '../../../../src/main/presenter/filePresenter/RtfFileAdapter'

describe('detectMimeType', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('treats TypeScript source files as application/typescript instead of video/mp2t', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-mime-'))
    tempDirs.push(tempDir)

    const filePath = path.join(tempDir, 'ipc.ts')
    await fs.writeFile(filePath, 'export const ipc = true\n', 'utf-8')

    await expect(detectMimeType(filePath)).resolves.toBe('application/typescript')
  })

  it('treats uppercase TypeScript extensions as application/typescript', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-mime-'))
    tempDirs.push(tempDir)

    const filePath = path.join(tempDir, 'IPC.TS')
    await fs.writeFile(filePath, 'export const ipc = true\n', 'utf-8')

    await expect(detectMimeType(filePath)).resolves.toBe('application/typescript')
  })

  it('keeps binary transport stream files as video/mp2t', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-mime-'))
    tempDirs.push(tempDir)

    const filePath = path.join(tempDir, 'sample.ts')
    await fs.writeFile(filePath, Buffer.from([0x00, 0x47, 0x10, 0x00]))

    await expect(detectMimeType(filePath)).resolves.toBe('video/mp2t')
  })

  it('detects common office and document extensions by filename', async () => {
    await expect(detectMimeType('/tmp/report.docx')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    await expect(detectMimeType('/tmp/report.docm')).resolves.toBe(
      'application/vnd.ms-word.document.macroenabled.12'
    )
    await expect(detectMimeType('/tmp/sheet.xlsx')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    await expect(detectMimeType('/tmp/deck.pptx')).resolves.toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    await expect(detectMimeType('/tmp/notes.rtf')).resolves.toBe('application/rtf')
    await expect(detectMimeType('/tmp/table.tsv')).resolves.toBe('text/tab-separated-values')
  })

  it('maps common attachment MIME types to processing adapters', () => {
    const map = getMimeTypeAdapterMap()

    expect(map.get('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      DocFileAdapter
    )
    expect(map.get('application/vnd.ms-word.document.macroenabled.12')).toBe(DocFileAdapter)
    expect(map.get('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      ExcelFileAdapter
    )
    expect(map.get('application/vnd.ms-excel.sheet.macroenabled.12')).toBe(ExcelFileAdapter)
    expect(
      map.get('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    ).toBe(PptFileAdapter)
    expect(map.get('application/vnd.ms-powerpoint.presentation.macroenabled.12')).toBe(
      PptFileAdapter
    )
    expect(map.get('application/vnd.oasis.opendocument.text')).toBe(OpenDocumentFileAdapter)
    expect(map.get('application/vnd.oasis.opendocument.presentation')).toBe(OpenDocumentFileAdapter)
    expect(map.get('application/rtf')).toBe(RtfFileAdapter)
    expect(map.get('text/tab-separated-values')).toBe(CsvFileAdapter)
    expect(map.get('image/svg+xml')).toBe(ImageFileAdapter)
    expect(map.get('image/heic')).toBe(ImageFileAdapter)
  })
})
