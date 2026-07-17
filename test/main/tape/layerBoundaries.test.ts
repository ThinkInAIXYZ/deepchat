import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const MAIN_SOURCE_ROOT = path.resolve(process.cwd(), 'src/main')
const TAPE_DOMAIN_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/domain')
const TAPE_SQLITE_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/infrastructure/sqlite')
const TAPE_SQLITE_RELATIVE_ROOT = 'tape/infrastructure/sqlite/'
const TYPESCRIPT_SOURCE_EXTENSION = /\.[cm]?tsx?$/

const PHYSICAL_TAPE_STORAGE_PATTERN =
  /\b(?:deepchat_tape_(?:entries|search_(?:projection(?:_meta)?|fts(?:_meta)?))|DeepChatTape(?:Entries|SearchProjection)Table|deepchatTape(?:Entries|SearchProjection)(?:Table)?)\b/

interface StorageBoundaryException {
  physicalName?: string
  sqliteImport?: string
}

const ALLOWED_STORAGE_EXCEPTIONS = new Map<string, StorageBoundaryException>([
  ['app/databaseSecurity.ts', { physicalName: 'database table-name security allowlist' }],
  [
    'app/startupMigrations/legacyChatImportService.ts',
    { physicalName: 'migration-only full-table replacement and projection cleanup' }
  ],
  [
    'data/schemaCatalog.ts',
    {
      physicalName: 'schema creation and migration registry',
      sqliteImport: 'schema adapter construction'
    }
  ],
  [
    'data/sqliteCopyExclusions.ts',
    { physicalName: 'SQLite virtual-table copy exclusion metadata' }
  ],
  [
    'memory/data/tables/deepchatMemoryIngestionProjection.ts',
    { physicalName: 'read-only single-statement Tape-head consistency check' }
  ],
  [
    'session/data/database.ts',
    {
      physicalName: 'SQLite adapter compatibility getters',
      sqliteImport: 'SQLite adapter composition'
    }
  ],
  [
    'session/data/tables/deepchatTapeEntries.ts',
    { sqliteImport: 'legacy import-path compatibility re-export' }
  ],
  [
    'session/data/tables/deepchatTapeSearchProjection.ts',
    { sqliteImport: 'legacy import-path compatibility re-export' }
  ],
  ['tape/ports/application.ts', { physicalName: 'legacy database-shape compatibility adapter' }]
])

function listTypeScriptSources(root: string, fs: typeof import('node:fs')): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) return listTypeScriptSources(entryPath, fs)
      if (entry.isFile() && TYPESCRIPT_SOURCE_EXTENSION.test(entry.name)) return [entryPath]
      return []
    })
    .sort()
}

function relativeToMain(file: string): string {
  return path.relative(MAIN_SOURCE_ROOT, file).split(path.sep).join('/')
}

function isInside(root: string, target: string): boolean {
  const relativePath = path.relative(root, target)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function resolveMainImport(importingFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return path.resolve(MAIN_SOURCE_ROOT, specifier.slice(2))
  }
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(importingFile), specifier)
  }
  return null
}

describe('Tape layer boundaries', () => {
  it('keeps the Tape domain independent from other main-process layers', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const violations = listTypeScriptSources(TAPE_DOMAIN_ROOT, fs).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const imports = ts.preProcessFile(source, true, true).importedFiles

      return imports.flatMap(({ fileName: specifier }) => {
        const target = resolveMainImport(file, specifier)
        if (!target || isInside(TAPE_DOMAIN_ROOT, target)) return []
        return [`${relativeToMain(file)} -> ${specifier}`]
      })
    })

    expect(violations).toEqual([])
  })

  it('allows physical Tape storage access only at explicit infrastructure boundaries', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const matchedExceptionCapabilities = new Set<string>()
    const violations = listTypeScriptSources(MAIN_SOURCE_ROOT, fs).flatMap((file) => {
      const relativeFile = relativeToMain(file)
      if (relativeFile.startsWith(TAPE_SQLITE_RELATIVE_ROOT)) return []

      const source = fs.readFileSync(file, 'utf8')
      const physicalName = source.match(PHYSICAL_TAPE_STORAGE_PATTERN)?.[0]
      const sqliteImport = ts
        .preProcessFile(source, true, true)
        .importedFiles.map(({ fileName }) => ({
          fileName,
          target: resolveMainImport(file, fileName)
        }))
        .find(({ target }) => target && isInside(TAPE_SQLITE_ROOT, target))?.fileName
      const exception = ALLOWED_STORAGE_EXCEPTIONS.get(relativeFile)
      const fileViolations: string[] = []

      if (physicalName) {
        if (exception?.physicalName) {
          matchedExceptionCapabilities.add(`${relativeFile}:physicalName`)
        } else {
          fileViolations.push(`${relativeFile}: physical name ${physicalName}`)
        }
      }
      if (sqliteImport) {
        if (exception?.sqliteImport) {
          matchedExceptionCapabilities.add(`${relativeFile}:sqliteImport`)
        } else {
          fileViolations.push(`${relativeFile}: SQLite import ${sqliteImport}`)
        }
      }
      return fileViolations
    })

    const staleExceptions = [...ALLOWED_STORAGE_EXCEPTIONS.entries()].flatMap(([file, exception]) =>
      (Object.entries(exception) as Array<[keyof StorageBoundaryException, string]>).flatMap(
        ([capability, reason]) =>
          matchedExceptionCapabilities.has(`${file}:${capability}`)
            ? []
            : [`${file} (${capability}): ${reason}`]
      )
    )

    expect(violations).toEqual([])
    expect(staleExceptions).toEqual([])
  })
})
