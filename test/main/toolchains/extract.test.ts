import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { replaceDirectory } from '../../../src/main/toolchains/extract'

function writeTree(rootDir: string, marker: string): void {
  mkdirSync(rootDir, { recursive: true })
  writeFileSync(path.join(rootDir, 'marker'), marker)
}

describe('replaceDirectory', () => {
  it('keeps the previous generation after a successful replace', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dc-extract-'))
    const dest = path.join(root, 'node', 'v24.18.0')
    const incoming = path.join(root, 'incoming')
    writeTree(dest, 'current')
    writeTree(incoming, 'next')

    replaceDirectory(incoming, dest)

    expect(readFileSync(path.join(dest, 'marker'), 'utf8')).toBe('next')
    expect(readFileSync(path.join(`${dest}.prev`, 'marker'), 'utf8')).toBe('current')
    expect(existsSync(`${dest}.next`)).toBe(false)
  })
})
