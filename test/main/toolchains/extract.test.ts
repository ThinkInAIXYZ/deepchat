import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { extractArchive, replaceDirectory } from '../../../src/main/toolchains/extract'
import { gcUnreachableToolchainTrees } from '../../../src/main/toolchains/layout'

function writeTree(rootDir: string, marker: string): void {
  mkdirSync(rootDir, { recursive: true })
  writeFileSync(path.join(rootDir, 'marker'), marker)
}

describe('toolchain extract', () => {
  it('rejects an already-aborted extract as cancelled', async () => {
    const destDir = path.join(mkdtempSync(path.join(os.tmpdir(), 'dc-ex-')), 'out')
    const controller = new AbortController()
    controller.abort()
    await expect(
      extractArchive(path.join(destDir, 'missing.tar.gz'), destDir, controller.signal)
    ).rejects.toMatchObject({ reason: 'cancelled' })
  })
})

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

describe('gcUnreachableToolchainTrees', () => {
  it('keeps activate sidecars and deletes old versions and staging', () => {
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-gc-'))
    const nodeRoot = path.join(userDataDir, 'toolchains', 'node')
    const current = path.join(nodeRoot, 'v24.18.0')
    const previous = `${current}.prev`
    const archived = `${current}.prev.1710000000000`
    const leftoverNext = `${current}.next`
    const oldVersion = path.join(nodeRoot, 'v22.14.0')
    const staging = path.join(userDataDir, 'toolchains', 'download', 'node-v22.14.0')
    writeTree(current, 'current')
    writeTree(previous, 'previous')
    writeTree(archived, 'archived')
    writeTree(leftoverNext, 'next')
    writeTree(oldVersion, 'old')
    writeTree(staging, 'staging')

    gcUnreachableToolchainTrees(userDataDir, [current])

    expect(existsSync(current)).toBe(true)
    expect(existsSync(previous)).toBe(true)
    expect(existsSync(archived)).toBe(true)
    expect(existsSync(leftoverNext)).toBe(true)
    expect(existsSync(oldVersion)).toBe(false)
    expect(existsSync(staging)).toBe(false)
  })

  it('skips an in-flight kind instead of collecting its trees', () => {
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-gc-'))
    const nodeRoot = path.join(userDataDir, 'toolchains', 'node')
    const current = path.join(nodeRoot, 'v24.18.0')
    const oldVersion = path.join(nodeRoot, 'v22.14.0')
    const staging = path.join(userDataDir, 'toolchains', 'download', 'node-v24.18.0')
    writeTree(current, 'current')
    writeTree(oldVersion, 'old')
    writeTree(staging, 'staging')

    gcUnreachableToolchainTrees(userDataDir, [current], {
      collectDownload: false,
      skipKinds: ['node']
    })

    expect(existsSync(oldVersion)).toBe(true)
    expect(existsSync(staging)).toBe(true)
  })
})
