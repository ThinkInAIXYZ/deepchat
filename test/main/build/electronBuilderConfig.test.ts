import { readFile } from 'fs/promises'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface ElectronBuilderConfig {
  asarUnpack?: string[]
}

interface PackageJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const OPENDAL_VERSION = '0.49.2'
const OPENDAL_NATIVE_PACKAGES = [
  '@opendal/lib-darwin-arm64',
  '@opendal/lib-darwin-x64',
  '@opendal/lib-linux-arm64-gnu',
  '@opendal/lib-linux-arm64-musl',
  '@opendal/lib-linux-x64-gnu',
  '@opendal/lib-linux-x64-musl',
  '@opendal/lib-win32-arm64-msvc',
  '@opendal/lib-win32-x64-msvc'
] as const

const readElectronBuilderConfig = async () => {
  const configPath = path.join(process.cwd(), 'electron-builder.yml')
  return parse(await readFile(configPath, 'utf8')) as ElectronBuilderConfig
}

const readPackageJson = async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json')
  return JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson
}

describe('electron-builder config', () => {
  it('unpacks native dependencies for packaged app loading and signing', async () => {
    const config = await readElectronBuilderConfig()

    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        '**/node_modules/@ff-labs/fff-node/**/*',
        '**/node_modules/@ff-labs/fff-bin-*/**/*',
        '**/node_modules/opendal/**/*',
        '**/node_modules/@opendal/**/*',
        '**/node_modules/ffi-rs/**/*',
        '**/node_modules/@yuuang/ffi-rs-*/**/*'
      ])
    )
  })

  it('pins OpenDAL native packages to the Ubuntu 22.04 compatible ABI version', async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.dependencies?.opendal).toBe(OPENDAL_VERSION)
    expect(Object.keys(packageJson.optionalDependencies ?? {}).sort()).toEqual(
      expect.arrayContaining([...OPENDAL_NATIVE_PACKAGES].sort())
    )

    for (const packageName of OPENDAL_NATIVE_PACKAGES) {
      expect(packageJson.optionalDependencies?.[packageName]).toBe(OPENDAL_VERSION)
    }
  })
})
