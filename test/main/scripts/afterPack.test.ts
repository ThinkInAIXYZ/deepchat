import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const loadAfterPack = async () => {
  return (await import('../../../scripts/afterPack.js')).default as (context: {
    targets: Array<{ name: string }>
    appOutDir: string
    electronPlatformName: string
  }) => Promise<void>
}

describe('afterPack Computer Use isolation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-after-pack-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('removes Computer Use runtime from Windows packages', async () => {
    const afterPack = await loadAfterPack()
    const computerUsePath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'runtime',
      'computer-use'
    )
    await mkdir(computerUsePath, { recursive: true })
    await writeFile(path.join(computerUsePath, 'helper.txt'), 'helper')

    await afterPack({
      targets: [],
      appOutDir: tmpDir,
      electronPlatformName: 'win32'
    })

    await expect(stat(computerUsePath)).rejects.toThrow()
  })

  it('removes Computer Use runtime and keeps the Linux no-sandbox wrapper', async () => {
    const afterPack = await loadAfterPack()
    const computerUsePath = path.join(
      tmpDir,
      'resources',
      'app.asar.unpacked',
      'runtime',
      'computer-use'
    )
    await mkdir(computerUsePath, { recursive: true })
    await writeFile(path.join(computerUsePath, 'helper.txt'), 'helper')
    await writeFile(path.join(tmpDir, 'deepchat'), '#!/bin/bash\n')

    await afterPack({
      targets: [{ name: 'AppImage' }],
      appOutDir: tmpDir,
      electronPlatformName: 'linux'
    })

    await expect(stat(computerUsePath)).rejects.toThrow()
    await expect(stat(path.join(tmpDir, 'deepchat.bin'))).resolves.toBeTruthy()
    await expect(stat(path.join(tmpDir, 'deepchat'))).resolves.toBeTruthy()
  })
})
