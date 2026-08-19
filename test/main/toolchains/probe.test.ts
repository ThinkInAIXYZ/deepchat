import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { probeSystemNode } from '../../../src/main/toolchains/probe'

function writeExecutable(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
  chmodSync(filePath, 0o755)
}

describe('toolchain probe', () => {
  it('locates Windows system Node via Path and .cmd siblings', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dc-win-node-'))
    writeExecutable(path.join(root, 'node.exe'))
    writeExecutable(path.join(root, 'npm.cmd'))
    writeExecutable(path.join(root, 'npx.cmd'))

    const probed = probeSystemNode({ Path: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32')
    expect(probed.status).toBe('complete')
    if (probed.status !== 'complete') return
    expect(probed.toolchain.node).toBe(path.join(root, 'node.exe'))
    expect(probed.toolchain.npm).toBe(path.join(root, 'npm.cmd'))
    expect(probed.toolchain.npx).toBe(path.join(root, 'npx.cmd'))
  })
})
