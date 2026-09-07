import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { probeCustomNode, probeSystemNode } from '../../../src/main/toolchains/probe'

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

  it('accepts a custom Node executable when npm and npx sit beside it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dc-custom-node-'))
    const node = path.join(root, 'node')
    const npm = path.join(root, 'npm')
    const npx = path.join(root, 'npx')
    writeExecutable(node)
    writeExecutable(npm)
    writeExecutable(npx)

    const probed = probeCustomNode(node, 'darwin')
    expect(probed.status).toBe('complete')
    if (probed.status !== 'complete') return
    expect(probed.toolchain.node).toBe(node)
    expect(probed.toolchain.npm).toBe(npm)
    expect(probed.toolchain.npx).toBe(npx)
    expect(probed.toolchain.binDir).toBe(root)
  })
})
