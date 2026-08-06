import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { extractSkillArchive } from '@/skill/archive'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-skill-archive-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeArchive(directory: string, entries: Record<string, Uint8Array>): string {
  const archivePath = path.join(directory, 'skill.zip')
  fs.writeFileSync(archivePath, zipSync(entries, { level: 9 }))
  return archivePath
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('extractSkillArchive', () => {
  it('streams regular files into the target directory', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'example/SKILL.md': strToU8('# Example'),
      'example/scripts/run.js': strToU8("console.log('ok')")
    })
    const target = path.join(root, 'target')

    await extractSkillArchive(archivePath, target)

    expect(fs.readFileSync(path.join(target, 'example', 'SKILL.md'), 'utf8')).toBe('# Example')
    expect(fs.readFileSync(path.join(target, 'example', 'scripts', 'run.js'), 'utf8')).toBe(
      "console.log('ok')"
    )
  })

  it('rejects traversal without writing outside the target', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      '../escaped.txt': strToU8('escaped')
    })
    const target = path.join(root, 'target')

    await expect(extractSkillArchive(archivePath, target)).rejects.toThrow('invalid path')
    expect(fs.existsSync(path.join(root, 'escaped.txt'))).toBe(false)
  })

  it('rejects archives whose declared output exceeds the total limit', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'one.txt': new Uint8Array(8),
      'two.txt': new Uint8Array(8)
    })

    await expect(
      extractSkillArchive(archivePath, path.join(root, 'target'), {
        maxExtractedBytes: 12
      })
    ).rejects.toThrow('total extracted size limit')
  })

  it('rejects oversized entries before their content is written', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'large.txt': new Uint8Array(16)
    })
    const target = path.join(root, 'target')

    await expect(extractSkillArchive(archivePath, target, { maxEntryBytes: 8 })).rejects.toThrow(
      'entry exceeds'
    )
    expect(fs.existsSync(path.join(target, 'large.txt'))).toBe(false)
  })

  it('rejects suspicious expansion ratios above the exempt size', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'repeated.bin': new Uint8Array(4096)
    })

    await expect(
      extractSkillArchive(archivePath, path.join(root, 'target'), {
        compressionRatioExemptBytes: 0,
        maxCompressionRatio: 2
      })
    ).rejects.toThrow('compression ratio limit')
  })

  it('rejects duplicate normalized paths', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'Example/SKILL.md': strToU8('one'),
      'example/skill.md': strToU8('two')
    })

    await expect(extractSkillArchive(archivePath, path.join(root, 'target'))).rejects.toThrow(
      'duplicate paths'
    )
  })

  it('rejects paths that create Windows alternate streams or device files', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'scripts/output.txt:payload': strToU8('one'),
      'NUL.txt': strToU8('two')
    })

    await expect(extractSkillArchive(archivePath, path.join(root, 'target'))).rejects.toThrow(
      'non-portable path'
    )
  })

  it('allows safe names that merely start with two dots', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      '..notes/SKILL.md': strToU8('notes')
    })
    const target = path.join(root, 'target')

    await extractSkillArchive(archivePath, target)

    expect(fs.readFileSync(path.join(target, '..notes', 'SKILL.md'), 'utf8')).toBe('notes')
  })

  it('rejects archives that exceed the entry limit', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'one.txt': strToU8('one'),
      'two.txt': strToU8('two')
    })

    await expect(
      extractSkillArchive(archivePath, path.join(root, 'target'), { maxEntries: 1 })
    ).rejects.toThrow('too many entries')
  })

  it('rejects compressed input above the configured byte limit', async () => {
    const root = createTemporaryDirectory()
    const archivePath = writeArchive(root, {
      'SKILL.md': strToU8('# Example')
    })

    await expect(
      extractSkillArchive(archivePath, path.join(root, 'target'), { maxArchiveBytes: 1 })
    ).rejects.toThrow('ZIP file too large')
  })
})
