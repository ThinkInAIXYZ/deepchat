import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { replaceDirectory } from '../../../src/main/toolchains/extract'
import { gcRetiredToolchainTrees } from '../../../src/main/toolchains/layout'

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

describe('gcRetiredToolchainTrees', () => {
  it('deletes timestamped archives and leftover next trees', () => {
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-gc-'))
    const nodeRoot = path.join(userDataDir, 'toolchains', 'node')
    const current = path.join(nodeRoot, 'v24.18.0')
    const previous = `${current}.prev`
    const archived = `${current}.prev.1710000000000`
    const leftoverNext = `${current}.next`
    writeTree(current, 'current')
    writeTree(previous, 'previous')
    writeTree(archived, 'archived')
    writeTree(leftoverNext, 'next')

    gcRetiredToolchainTrees(userDataDir)

    expect(existsSync(current)).toBe(true)
    expect(existsSync(previous)).toBe(true)
    expect(existsSync(archived)).toBe(false)
    expect(existsSync(leftoverNext)).toBe(false)
  })
})
