import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const MAIN_SOURCE_ROOT = path.resolve(process.cwd(), 'src/main')
const TAPE_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape')
const TAPE_DOMAIN_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/domain')
const TAPE_SQLITE_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/infrastructure/sqlite')
const TAPE_CAPABILITIES_MODULE = path.join(MAIN_SOURCE_ROOT, 'tape/ports/capabilities')
const TAPE_SESSION_FACADE_MODULE = path.join(MAIN_SOURCE_ROOT, 'tape/application/sessionTape')
const MEMORY_ROUTES_FILE = path.join(MAIN_SOURCE_ROOT, 'memory/routes.ts')
const TAPE_SQLITE_RELATIVE_ROOT = 'tape/infrastructure/sqlite/'
const TYPESCRIPT_SOURCE_EXTENSION = /\.[cm]?tsx?$/

interface LegacyTapeCompatibilityContract {
  target: string
  valueExports: readonly string[]
  typeExports: readonly string[]
  typeAliases?: Readonly<Record<string, string>>
}

const LEGACY_TAPE_COMPATIBILITY_MODULES = new Map<string, LegacyTapeCompatibilityContract>([
  [
    'session/data/tape',
    {
      target: '@/tape/application/sessionTape',
      valueExports: [
        'AgentTapeViewError',
        'normalizeSubagentTapeLinkInput',
        'normalizeTapeHandoffState',
        'SessionTape'
      ],
      typeExports: [
        'AgentTapeViewErrorCode',
        'TapeAnchorResult',
        'TapeBackfillResult',
        'TapeForkHandle',
        'TapeInfo',
        'TapeMigrationState',
        'TapeSearchResult'
      ],
      typeAliases: { TapeViewManifestSourceMaps: 'TapeViewManifestAssemblySources' }
    }
  ],
  [
    'session/data/tapeEffectiveView',
    {
      target: '@/tape/domain/effectiveView',
      valueExports: [
        'buildEffectiveTapeView',
        'getLastEffectiveTokenUsage',
        'searchEffectiveTapeRows'
      ],
      typeExports: ['EffectiveMessageEntry', 'EffectiveTapeView']
    }
  ],
  [
    'session/data/tapeFacts',
    {
      target: '@/tape/application/factPersistence',
      valueExports: [
        'appendMessageRecordToTape',
        'appendMessageReplacementToTape',
        'appendMessageRetractionToTape',
        'appendTapeToolFact',
        'appendToolFactsToTape',
        'buildTapeToolFactInputs',
        'tapeEntriesToEffectiveMessageRecords',
        'tapeEntryToMessageRecord'
      ],
      typeExports: ['TapeFactSource']
    }
  ],
  [
    'session/data/tapeViewManifest',
    {
      target: '@/tape/domain/viewManifest',
      valueExports: [
        'buildExcludedRefs',
        'buildIncludedRefs',
        'buildRequestRefs',
        'createTapeViewManifest',
        'hashJson',
        'isCompactionRecord',
        'resolveTapeViewManifestPolicy',
        'stableJsonStringify',
        'TAPE_VIEW_CONTEXT_BUILDER_VERSION',
        'TAPE_VIEW_MANIFEST_EVENT_NAME',
        'TAPE_VIEW_MANIFEST_HASH_VERSION',
        'verifyTapeViewManifestHash'
      ],
      typeExports: [
        'ContextSummaryCursorMetadata',
        'TapeViewContextSelection',
        'TapeViewManifestBuildInput',
        'TapeViewManifestPolicyInput',
        'TapeViewManifestPolicyResult'
      ],
      typeAliases: { TapeViewManifestSourceMaps: 'TapeViewManifestLookupMaps' }
    }
  ],
  [
    'session/data/tables/deepchatTapeEffectiveSemantics',
    {
      target: '@/tape/domain/effectiveSemantics',
      valueExports: [
        'messageRecordHasFinalToolUse',
        'parseAssistantBlocks',
        'parseNestedTapeJsonObject',
        'parseTapeJsonObject',
        'readTapeMessageRetractionId',
        'readTapeToolIdentity',
        'readTapeToolStatus',
        'tapeEntryToMessageRecord',
        'tapeMessageRank',
        'tapeToolRank'
      ],
      typeExports: ['DeepChatTapeToolIdentity']
    }
  ],
  [
    'session/data/tables/deepchatTapeEntries',
    {
      target: '@/tape/infrastructure/sqlite/tapeEntryStore',
      valueExports: [
        'buildDeepChatTapeFtsMatch',
        'buildDeepChatTapeLikeSearchPredicate',
        'DeepChatTapeEntriesTable',
        'normalizeDeepChatTapeReadSources',
        'serializeDeepChatTapeReadSources',
        'SUMMARY_ANCHOR_NAMES',
        'TAPE_INCARNATION_META_KEY'
      ],
      typeExports: [
        'DeepChatTapeAppendInput',
        'DeepChatTapeEntryKind',
        'DeepChatTapeEntryRow',
        'DeepChatTapeMutationProjection',
        'DeepChatTapeReadSource',
        'DeepChatTapeSearchInput',
        'DeepChatTapeSourceInput',
        'DeepChatTapeSourceType'
      ]
    }
  ],
  [
    'session/data/tables/deepchatTapeSearchProjection',
    {
      target: '@/tape/infrastructure/sqlite/tapeSearchProjectionStore',
      valueExports: [
        'DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION',
        'DeepChatTapeSearchProjectionTable'
      ],
      typeExports: [
        'DeepChatTapeSearchProjectionInput',
        'DeepChatTapeSearchProjectionMeta',
        'DeepChatTapeSearchProjectionReadResult',
        'DeepChatTapeSearchProjectionResultRow',
        'DeepChatTapeSearchProjectionRow'
      ]
    }
  ]
])

const CAPABILITY_SCOPED_CONSUMER_FILES = [
  'agent/acp/compatibility/adapters.ts',
  'agent/acp/compatibility/dependencies.ts',
  'agent/deepchat/memory/memoryRuntimeCoordinator.ts',
  'agent/deepchat/runtime/deepChatLoopRunner.ts',
  'agent/deepchat/runtime/turnCoordinator.ts',
  'app/startupMigrations/legacyChatImportService.ts',
  'memory/routes.ts',
  'session/data/settings.ts',
  'session/data/transcript.ts'
].map((file) => path.join(MAIN_SOURCE_ROOT, file))

const FORBIDDEN_DOMAIN_SQLITE_IMPORTS = new Set([
  'better-sqlite3',
  'better-sqlite3-multiple-ciphers',
  'bun:sqlite',
  'node:sqlite',
  'sql.js',
  'sqlite3'
])
const FORBIDDEN_DOMAIN_LOGGING_IMPORTS = new Set([
  '@shared/logger',
  'electron-log',
  'loglevel',
  'pino',
  'winston'
])

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
    {
      physicalName: 'frozen legacy compatibility export',
      sqliteImport: 'legacy import-path compatibility re-export'
    }
  ],
  [
    'session/data/tables/deepchatTapeSearchProjection.ts',
    {
      physicalName: 'frozen legacy compatibility export',
      sqliteImport: 'legacy import-path compatibility re-export'
    }
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

function withoutTypeScriptExtension(file: string): string {
  return file.replace(TYPESCRIPT_SOURCE_EXTENSION, '')
}

function matchesPackageOrSubpath(specifier: string, packages: ReadonlySet<string>): boolean {
  return [...packages].some(
    (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`)
  )
}

function getForbiddenDomainPackageCategory(specifier: string): string | null {
  if (
    specifier === 'electron' ||
    specifier.startsWith('electron/') ||
    specifier.startsWith('@electron/')
  ) {
    return 'Electron runtime'
  }
  if (
    matchesPackageOrSubpath(specifier, FORBIDDEN_DOMAIN_SQLITE_IMPORTS) ||
    specifier.startsWith('@libsql/')
  ) {
    return 'SQLite runtime'
  }
  if (matchesPackageOrSubpath(specifier, FORBIDDEN_DOMAIN_LOGGING_IMPORTS)) {
    return 'logging runtime'
  }
  return null
}

function getDomainImportViolation(importingFile: string, specifier: string): string | null {
  const forbiddenPackageCategory = getForbiddenDomainPackageCategory(specifier)
  if (forbiddenPackageCategory) {
    return `${forbiddenPackageCategory} import ${specifier}`
  }

  const target = resolveMainImport(importingFile, specifier)
  if (target && !isInside(TAPE_DOMAIN_ROOT, target)) {
    return `main-process dependency ${specifier}`
  }
  return null
}

function isLegacyTapeCompatibilityImport(importingFile: string, specifier: string): boolean {
  const target = resolveMainImport(importingFile, specifier)
  if (!target) return false
  const relativeTarget = relativeToMain(withoutTypeScriptExtension(target))
  return LEGACY_TAPE_COMPATIBILITY_MODULES.has(relativeTarget)
}

function isTapeModuleImport(importingFile: string, specifier: string): boolean {
  const target = resolveMainImport(importingFile, specifier)
  return Boolean(target && isInside(TAPE_ROOT, target))
}

function findConcreteTapeFacadeImportViolations(source: string, file: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName: specifier }) => {
    const target = resolveMainImport(file, specifier)
    return target && withoutTypeScriptExtension(target) === TAPE_SESSION_FACADE_MODULE
      ? [`Concrete Tape facade import: ${specifier}`]
      : []
  })
}

function findMemoryRouteTapeImportViolations(source: string, file: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const tapeReferences = ts
    .preProcessFile(source, true, true)
    .importedFiles.filter(({ fileName }) => isTapeModuleImport(file, fileName))
  const staticTapeImports = sourceFile.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isTapeModuleImport(file, statement.moduleSpecifier.text)
  )
  const violations = tapeReferences.flatMap(({ fileName: specifier }) => {
    const target = resolveMainImport(file, specifier)
    return !target || withoutTypeScriptExtension(target) !== TAPE_CAPABILITIES_MODULE
      ? [`Tape import must use the inspection port: ${specifier}`]
      : []
  })

  if (tapeReferences.length !== staticTapeImports.length) {
    violations.push('Tape references must use a static type-only import declaration')
  }

  violations.push(
    ...staticTapeImports.flatMap((statement) => {
      const specifier = statement.moduleSpecifier.text
      const importClause = statement.importClause
      const namedBindings = importClause?.namedBindings
      if (
        !importClause ||
        importClause.name ||
        !namedBindings ||
        !ts.isNamedImports(namedBindings) ||
        namedBindings.elements.length !== 1
      ) {
        return [`Tape capabilities import must name only TapeInspectionReader: ${specifier}`]
      }

      const [element] = namedBindings.elements
      const importedName = element.propertyName?.text ?? element.name.text
      const isTypeOnly = importClause.isTypeOnly || element.isTypeOnly
      return importedName === 'TapeInspectionReader' && isTypeOnly
        ? []
        : [`Memory routes may import only the TapeInspectionReader type: ${importedName}`]
    })
  )

  return [...new Set(violations)]
}

function compatibilityExportDescriptors(contract: LegacyTapeCompatibilityContract): string[] {
  return [
    ...contract.valueExports.map((name) => `value:${name}:${name}`),
    ...contract.typeExports.map((name) => `type:${name}:${name}`),
    ...Object.entries(contract.typeAliases ?? {}).map(
      ([exportedName, importedName]) => `type:${importedName}:${exportedName}`
    )
  ].sort()
}

function isFrozenCompatibilityReexport(
  source: string,
  contract: LegacyTapeCompatibilityContract
): boolean {
  if (!source.includes('@deprecated')) return false
  const sourceFile = ts.createSourceFile('compatibility.ts', source, ts.ScriptTarget.Latest, true)
  const descriptors = sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== contract.target
    ) {
      return ['invalid']
    }
    return statement.exportClause.elements.map((element) => {
      const importedName = element.propertyName?.text ?? element.name.text
      const exportedName = element.name.text
      const kind = statement.isTypeOnly || element.isTypeOnly ? 'type' : 'value'
      return `${kind}:${importedName}:${exportedName}`
    })
  })
  return (
    sourceFile.statements.length > 0 &&
    JSON.stringify(descriptors.sort()) === JSON.stringify(compatibilityExportDescriptors(contract))
  )
}

describe('Tape layer boundaries', () => {
  it('keeps the Tape domain independent from other main-process layers', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const violations = listTypeScriptSources(TAPE_DOMAIN_ROOT, fs).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      const imports = ts.preProcessFile(source, true, true).importedFiles

      return imports.flatMap(({ fileName: specifier }) => {
        const violation = getDomainImportViolation(file, specifier)
        return violation ? [`${relativeToMain(file)}: ${violation}`] : []
      })
    })

    expect(violations).toEqual([])
  })

  it('keeps production code off legacy Tape compatibility imports', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const violations = listTypeScriptSources(MAIN_SOURCE_ROOT, fs).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      return ts
        .preProcessFile(source, true, true)
        .importedFiles.flatMap(({ fileName: specifier }) =>
          isLegacyTapeCompatibilityImport(file, specifier)
            ? [`${relativeToMain(file)} -> ${specifier}`]
            : []
        )
    })

    expect(violations).toEqual([])
  })

  it('keeps legacy Tape compatibility modules on frozen deprecated export contracts', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const violations = [...LEGACY_TAPE_COMPATIBILITY_MODULES.entries()].flatMap(
      ([relativeModule, contract]) => {
        const file = path.join(MAIN_SOURCE_ROOT, `${relativeModule}.ts`)
        const source = fs.readFileSync(file, 'utf8')
        return isFrozenCompatibilityReexport(source, contract)
          ? []
          : [`${relativeModule}.ts must match its frozen ${contract.target} export contract`]
      }
    )

    expect(violations).toEqual([])
  })

  it('keeps Memory routes on the Tape inspection DTO port', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const source = fs.readFileSync(MEMORY_ROUTES_FILE, 'utf8')
    expect(findMemoryRouteTapeImportViolations(source, MEMORY_ROUTES_FILE)).toEqual([])
  })

  it('keeps capability-scoped consumers off the concrete Tape facade', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const violations = CAPABILITY_SCOPED_CONSUMER_FILES.flatMap((file) =>
      findConcreteTapeFacadeImportViolations(fs.readFileSync(file, 'utf8'), file).map(
        (violation) => `${relativeToMain(file)}: ${violation}`
      )
    )

    expect(violations).toEqual([])
  })

  it.each([
    ['Session', '@/session/data/transcript'],
    ['Agent', '@/agent/deepchat/runtime/process'],
    ['Memory', '@/memory/routes'],
    ['App', '@/app/composition'],
    ['Tape ports', '@/tape/ports/capabilities'],
    ['Tape SQLite infrastructure', '@/tape/infrastructure/sqlite/tapeEntryStore'],
    ['bare SQLite', 'better-sqlite3'],
    ['project SQLite driver', 'better-sqlite3-multiple-ciphers'],
    ['Node SQLite', 'node:sqlite'],
    ['Electron', 'electron'],
    ['Electron subpath', 'electron/main'],
    ['shared logging', '@shared/logger'],
    ['Electron logging', 'electron-log']
  ])('detects forbidden %s imports in the Tape domain', (_category, specifier) => {
    const importingFile = path.join(TAPE_DOMAIN_ROOT, 'negative-case.ts')
    expect(getDomainImportViolation(importingFile, specifier)).not.toBeNull()
  })

  it.each([
    ['domain sibling', './entry'],
    ['domain alias', '@/tape/domain/effectiveView'],
    ['shared type', '@shared/types/tape-replay'],
    ['Node crypto', 'node:crypto']
  ])('allows pure %s imports in the Tape domain', (_category, specifier) => {
    const importingFile = path.join(TAPE_DOMAIN_ROOT, 'allowed-case.ts')
    expect(getDomainImportViolation(importingFile, specifier)).toBeNull()
  })

  it.each([
    [path.join(MAIN_SOURCE_ROOT, 'agent/example.ts'), '@/session/data/tape'],
    [path.join(MAIN_SOURCE_ROOT, 'session/data/index.ts'), './tapeFacts'],
    [
      path.join(MAIN_SOURCE_ROOT, 'memory/example.ts'),
      '@/session/data/tables/deepchatTapeEffectiveSemantics'
    ],
    [path.join(MAIN_SOURCE_ROOT, 'memory/example.ts'), '@/session/data/tables/deepchatTapeEntries'],
    [
      path.join(MAIN_SOURCE_ROOT, 'app/example.ts'),
      '@/session/data/tables/deepchatTapeSearchProjection'
    ]
  ])('detects legacy Tape compatibility import %s -> %s', (importingFile, specifier) => {
    expect(isLegacyTapeCompatibilityImport(importingFile, specifier)).toBe(true)
  })

  it.each([
    [
      'raw reader capability',
      "import type { TapeRawEntryReader } from '@/tape/ports/capabilities'"
    ],
    [
      'effective-view helper',
      "import { buildEffectiveTapeView } from '@/tape/domain/effectiveView'"
    ],
    ['application facade', "import { SessionTape } from '@/tape/application/sessionTape'"],
    ['inspection value import', "import { TapeInspectionReader } from '@/tape/ports/capabilities'"],
    ['dynamic import', "void import('@/tape/application/sessionTape')"],
    ['CommonJS require', "const tape = require('@/tape/domain/effectiveView')"],
    ['type re-export', "export type { TapeInspectionReader } from '@/tape/ports/capabilities'"]
  ])('detects Memory route Tape bypass through %s', (_category, source) => {
    expect(findMemoryRouteTapeImportViolations(source, MEMORY_ROUTES_FILE)).not.toEqual([])
  })

  it('allows Memory routes to import only the inspection reader type', () => {
    const source = "import type { TapeInspectionReader } from '@/tape/ports/capabilities'"
    expect(findMemoryRouteTapeImportViolations(source, MEMORY_ROUTES_FILE)).toEqual([])
  })

  it('allows inline type syntax for the Memory inspection reader', () => {
    const source = "import { type TapeInspectionReader } from '@/tape/ports/capabilities'"
    expect(findMemoryRouteTapeImportViolations(source, MEMORY_ROUTES_FILE)).toEqual([])
  })

  it.each([
    ['star export', "/** @deprecated */\nexport * from '@/tape/domain/effectiveView'"],
    [
      'extra export',
      "/** @deprecated */\nexport { buildEffectiveTapeView, getLastEffectiveTokenUsage, searchEffectiveTapeRows, unexpected } from '@/tape/domain/effectiveView'\nexport type { EffectiveMessageEntry, EffectiveTapeView } from '@/tape/domain/effectiveView'"
    ],
    [
      'missing export',
      "/** @deprecated */\nexport { buildEffectiveTapeView } from '@/tape/domain/effectiveView'\nexport type { EffectiveMessageEntry, EffectiveTapeView } from '@/tape/domain/effectiveView'"
    ],
    [
      'missing deprecation marker',
      "export { buildEffectiveTapeView, getLastEffectiveTokenUsage, searchEffectiveTapeRows } from '@/tape/domain/effectiveView'\nexport type { EffectiveMessageEntry, EffectiveTapeView } from '@/tape/domain/effectiveView'"
    ]
  ])('rejects a legacy compatibility contract with a %s', (_case, source) => {
    const contract = LEGACY_TAPE_COMPATIBILITY_MODULES.get('session/data/tapeEffectiveView')!
    expect(isFrozenCompatibilityReexport(source, contract)).toBe(false)
  })

  it.each(['@/tape/application/sessionTape', '../../tape/application/sessionTape'])(
    'detects concrete Tape facade import %s in a capability-scoped consumer',
    (specifier) => {
      const file = path.join(MAIN_SOURCE_ROOT, 'session/data/consumer.ts')
      const source = `import { SessionTape } from '${specifier}'`
      expect(findConcreteTapeFacadeImportViolations(source, file)).not.toEqual([])
    }
  )

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
