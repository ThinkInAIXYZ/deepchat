import { readFile } from 'fs/promises'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ElectronBuilderConfig {
  asarUnpack?: string[]
}

const readElectronBuilderConfig = async () => {
  const configPath = path.join(process.cwd(), 'electron-builder.yml')
  return parse(await readFile(configPath, 'utf8')) as ElectronBuilderConfig
}

describe('electron-builder config', () => {
  it('unpacks FFF native dependencies for packaged app loading and signing', async () => {
    const config = await readElectronBuilderConfig()

    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/@ff-labs/fff-node/**/*',
        '**/node_modules/@ff-labs/fff-bin-*/**/*',
        '**/node_modules/ffi-rs/**/*',
        '**/node_modules/@yuuang/ffi-rs-*/**/*'
      ])
    )
  })
})
