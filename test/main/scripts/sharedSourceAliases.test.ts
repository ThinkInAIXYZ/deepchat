import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  exports: Record<string, { import: string }>
}

type TsConfig = {
  compilerOptions: {
    paths: Record<string, string[]>
  }
}

const root = process.cwd()

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as T
}

function sharedSourcePaths(manifest: PackageManifest): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, target]) => [
      `@deepchat/shared/${subpath.slice(2)}`,
      [`./packages/shared/src/${target.import.slice('./dist/'.length).replace(/\.js$/, '.ts')}`]
    ])
  )
}

describe('shared source aliases', () => {
  it.each(['tsconfig.node.json', 'tsconfig.app.json'])(
    '%s maps exactly the public shared manifest to source',
    async (configPath) => {
      const [manifest, config] = await Promise.all([
        readJson<PackageManifest>('packages/shared/package.json'),
        readJson<TsConfig>(configPath)
      ])
      const expected = sharedSourcePaths(manifest)
      const actual = Object.fromEntries(
        Object.entries(config.compilerOptions.paths).filter(([key]) =>
          key.startsWith('@deepchat/shared/')
        )
      )

      expect(actual).toEqual(expected)
      expect(
        Object.entries(config.compilerOptions.paths).filter(
          ([key, values]) => key.startsWith('@shared/') && values[0]?.startsWith('./packages/shared/')
        )
      ).toEqual([])
    }
  )
})
