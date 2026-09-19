import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  exports: Record<string, { import: string }>
}

type TsConfig = {
  compilerOptions: {
    paths: Record<string, string[]>
  }
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workspaceRoot = path.resolve(desktopRoot, '../..')

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(workspaceRoot, relativePath), 'utf8')) as T
}

function sharedSourcePaths(manifest: PackageManifest): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, target]) => [
      `@deepchat/shared/${subpath.slice(2)}`,
      [
        `../../packages/shared/src/${target.import.slice('./dist/'.length).replace(/\.js$/, '.ts')}`
      ]
    ])
  )
}

describe('shared source aliases', () => {
  it.each(['tsconfig.node.json', 'tsconfig.app.json'])(
    '%s maps exactly the public shared manifest to source',
    async (configPath) => {
      const [manifest, config] = await Promise.all([
        readJson<PackageManifest>('packages/shared/package.json'),
        JSON.parse(await readFile(path.join(desktopRoot, configPath), 'utf8')) as TsConfig
      ])
      const expected = sharedSourcePaths(manifest)
      const actual = Object.fromEntries(
        Object.entries(config.compilerOptions.paths).filter(([key]) => key.startsWith('@deepchat/shared/'))
      )

      expect(actual).toEqual(expected)
      expect(
        Object.entries(config.compilerOptions.paths).filter(
          ([key, values]) => key.startsWith('@shared/') && values[0]?.startsWith('../../packages/shared/')
        )
      ).toEqual([])
    }
  )

  it('keeps the legacy attachment type bound to its shared owner instead of any', () => {
    const config = ts.readConfigFile(path.join(desktopRoot, 'tsconfig.node.json'), ts.sys.readFile)
    expect(config.error).toBeUndefined()
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, desktopRoot, {
      noEmit: true,
      composite: false,
      incremental: false
    })
    expect(parsed.errors).toEqual([])

    const hostPath = path.join(desktopRoot, 'src/shared/chat.d.ts')
    const sharedPath = path.join(workspaceRoot, 'packages/shared/src/chat.ts')
    const program = ts.createProgram([hostPath, sharedPath], parsed.options)
    const checker = program.getTypeChecker()
    const attachmentSymbol = (filePath: string) => {
      const source = program.getSourceFile(filePath)!
      const module = checker.getSymbolAtLocation(source)!
      const symbol = checker.getExportsOfModule(module).find((entry) => entry.name === 'MessageFile')!
      return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    }
    const hostSymbol = attachmentSymbol(hostPath)
    const sharedSymbol = attachmentSymbol(sharedPath)

    expect(hostSymbol).toBe(sharedSymbol)
    expect(checker.getDeclaredTypeOfSymbol(hostSymbol).flags & ts.TypeFlags.Any).toBe(0)
  })
})
