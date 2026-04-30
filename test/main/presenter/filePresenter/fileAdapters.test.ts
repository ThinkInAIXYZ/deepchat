import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { CsvFileAdapter } from '../../../../src/main/presenter/filePresenter/CsvFileAdapter'
import { OpenDocumentFileAdapter } from '../../../../src/main/presenter/filePresenter/OpenDocumentFileAdapter'
import { RtfFileAdapter } from '../../../../src/main/presenter/filePresenter/RtfFileAdapter'

describe('file adapters', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  async function createTempFile(name: string, content: string | Buffer): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-file-adapter-'))
    tempDirs.push(tempDir)
    const filePath = path.join(tempDir, name)
    await fs.writeFile(filePath, content)
    return filePath
  }

  it('generates table previews for TSV files', async () => {
    const filePath = await createTempFile(
      'people.tsv',
      'Name\tRole\nAda\tEngineer\nGrace\tAdmiral\n'
    )
    const adapter = new CsvFileAdapter(filePath, 1024 * 1024)

    const content = await adapter.getLLMContent()

    expect(content).toContain('* **Total Columns:** 2')
    expect(content).toContain('1. Name')
    expect(content).toContain('| Name | Role |')
    expect(content).toContain('| Ada | Engineer |')
  })

  it('extracts readable text from RTF files', async () => {
    const filePath = await createTempFile('note.rtf', '{\\rtf1\\ansi Hello\\par World}')
    const adapter = new RtfFileAdapter(filePath, 1024 * 1024)

    const content = await adapter.getContent()

    expect(content).toBe('Hello\nWorld')
  })

  it('extracts text from OpenDocument content.xml', async () => {
    const archive = Buffer.from(
      zipSync({
        'content.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
          <office:document-content
            xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
            xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
            <office:body>
              <office:text>
                <text:h>Quarterly Notes</text:h>
                <text:p>Revenue increased.</text:p>
              </office:text>
            </office:body>
          </office:document-content>`)
      })
    )
    const filePath = await createTempFile('notes.odt', archive)
    const adapter = new OpenDocumentFileAdapter(filePath, 1024 * 1024)

    const content = await adapter.getContent()

    expect(content).toContain('Quarterly Notes')
    expect(content).toContain('Revenue increased.')
  })
})
