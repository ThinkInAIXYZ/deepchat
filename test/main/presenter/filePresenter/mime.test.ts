import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectMimeType } from '../../../../src/main/presenter/filePresenter/mime'

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

  it('keeps binary transport stream files as video/mp2t', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-mime-'))
    tempDirs.push(tempDir)

    const filePath = path.join(tempDir, 'sample.ts')
    await fs.writeFile(filePath, Buffer.from([0x00, 0x47, 0x10, 0x00]))

    await expect(detectMimeType(filePath)).resolves.toBe('video/mp2t')
  })
})
