import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import {
  createDeepChatLoopTapePort,
  createSkillContextTapePort,
  createSkillExecutionAuthorityTapePort
} from '@/tape/application/capabilityAdapters'
import type {
  CommitNestedExecutionDispatchInput,
  CommitNestedExecutionToolOutcomeInput
} from '@/tape/domain/executionJournal'

const MAIN_SOURCE_ROOT = path.resolve(process.cwd(), 'src/main')
const TAPE_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape')
const TAPE_DOMAIN_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/domain')
const TAPE_SQLITE_ROOT = path.join(MAIN_SOURCE_ROOT, 'tape/infrastructure/sqlite')
const TAPE_CAPABILITIES_MODULE = path.join(MAIN_SOURCE_ROOT, 'tape/ports/capabilities')
const TAPE_SESSION_FACADE_MODULE = path.join(MAIN_SOURCE_ROOT, 'tape/application/sessionTape')
const MEMORY_ROUTES_FILE = path.join(MAIN_SOURCE_ROOT, 'memory/routes.ts')
const TAPE_SQLITE_RELATIVE_ROOT = 'tape/infrastructure/sqlite/'
const TYPESCRIPT_SOURCE_EXTENSION = /\.[cm]?tsx?$/

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

  it('keeps Skill materialization authority out of the provider-loop Tape port', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const sourceText = fs.readFileSync(TAPE_CAPABILITIES_MODULE + '.ts', 'utf8')
    const sourceFile = ts.createSourceFile(
      TAPE_CAPABILITIES_MODULE + '.ts',
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const declaration = sourceFile.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === 'DeepChatLoopTapePort'
    )
    expect(declaration, 'DeepChatLoopTapePort declaration not found').toBeDefined()
    const inheritedCapabilities =
      declaration?.heritageClauses
        ?.flatMap((clause) => clause.types)
        .map((type) => type.expression.getText(sourceFile)) ?? []
    const declaredMembers =
      declaration?.members.map((member) => member.name?.getText(sourceFile) ?? '') ?? []

    expect(inheritedCapabilities).not.toContain('TapeSkillMaterializationWriter')
    expect(inheritedCapabilities).not.toContain('TapeSkillMaterializationReader')
    expect(declaredMembers).not.toContain('materializeSkillContexts')
    expect(declaredMembers).not.toContain('readSkillMaterialization')
  })

  it('confines Skill materialization authority to dedicated runtime readers', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const callSites = listTypeScriptSources(MAIN_SOURCE_ROOT, fs)
      .filter((file) => !isInside(TAPE_ROOT, file))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return /\.(?:materializeSkillContexts|readSkillMaterialization)\s*\(/.test(source)
          ? [relativeToMain(file)]
          : []
      })
      .sort()

    expect(callSites).toEqual([
      'agent/deepchat/runtime/skillContextMaterializer.ts',
      'skill/skillExecutionAuthority.ts'
    ])
  })

  it('narrows Skill Tape collaborators to their runtime capability sets', () => {
    const source = {
      getTapeIncarnationId: vi.fn(),
      materializeSkillContexts: vi.fn(),
      readSkillMaterialization: vi.fn(),
      getEffectiveUserMessageSourceEntryId: vi.fn(),
      getLatestViewManifestByRunBinding: vi.fn(),
      getViewManifestByExecutionBinding: vi.fn(),
      appendMessageRecord: vi.fn()
    }

    const contextPort = createSkillContextTapePort(source)
    const authorityPort = createSkillExecutionAuthorityTapePort(source)

    expect(Object.isFrozen(contextPort)).toBe(true)
    expect(Object.keys(contextPort).sort()).toEqual([
      'getEffectiveUserMessageSourceEntryId',
      'getLatestViewManifestByRunBinding',
      'getTapeIncarnationId',
      'materializeSkillContexts',
      'readSkillMaterialization'
    ])
    expect(Object.isFrozen(authorityPort)).toBe(true)
    expect(Object.keys(authorityPort).sort()).toEqual([
      'getTapeIncarnationId',
      'getViewManifestByExecutionBinding',
      'readSkillMaterialization'
    ])
    expect('appendMessageRecord' in contextPort).toBe(false)
    expect('appendMessageRecord' in authorityPort).toBe(false)
  })

  it('gives the provider loop only its declared runtime Tape capabilities', () => {
    const source = {
      ensureSessionTapeReady: vi.fn(),
      getViewManifestSourceMaps: vi.fn(),
      listViewManifestsByMessage: vi.fn(),
      listViewManifestsByMessageRequest: vi.fn(),
      getViewManifestByExecutionBinding: vi.fn(),
      assertSkillRequestAuthority: vi.fn(),
      appendViewManifest: vi.fn(),
      commitToolSurfaceView: vi.fn(),
      appendToolFact: vi.fn(async () => ({ sessionId: 's1', entryId: 1, toolResult: null })),
      getTapeIncarnationId: vi.fn(),
      appendSkillViewResultFact: vi.fn(),
      recoverRuntimeSkillViewContexts: vi.fn(),
      appendProviderAttempt: vi.fn(),
      getMaxProviderAttemptRequestSeq: vi.fn(),
      getPendingProviderContextPressure: vi.fn(),
      commitRunStarted: vi.fn(),
      commitDispatch: vi.fn(),
      commitToolOutcome: vi.fn(),
      commitRunTerminal: vi.fn(),
      materializeSkillContexts: vi.fn(),
      appendMessageRecord: vi.fn()
    }
    const nestedExecutionJournal = {
      commitNestedDispatch: vi.fn(),
      commitNestedToolOutcome: vi.fn()
    }

    const loopPort = createDeepChatLoopTapePort(source, nestedExecutionJournal)

    expect(Object.isFrozen(loopPort)).toBe(true)
    expect(Object.keys(loopPort).sort()).toEqual([
      'appendProviderAttempt',
      'appendSkillViewResultFact',
      'appendToolFact',
      'appendViewManifest',
      'assertSkillRequestAuthority',
      'commitDispatch',
      'commitNestedDispatch',
      'commitNestedToolOutcome',
      'commitRunStarted',
      'commitRunTerminal',
      'commitToolOutcome',
      'commitToolSurfaceView',
      'ensureSessionTapeReady',
      'getMaxProviderAttemptRequestSeq',
      'getPendingProviderContextPressure',
      'getTapeIncarnationId',
      'getViewManifestByExecutionBinding',
      'getViewManifestSourceMaps',
      'listViewManifestsByMessage',
      'listViewManifestsByMessageRequest',
      'recoverRuntimeSkillViewContexts'
    ])
    expect('materializeSkillContexts' in loopPort).toBe(false)
    expect('appendMessageRecord' in loopPort).toBe(false)

    const operation = {
      runId: 'run-1',
      requestSeq: 1,
      providerToolCallId: 'outer-1',
      kind: 'nested',
      childOrdinal: 0
    } as const
    const nestedDispatch: CommitNestedExecutionDispatchInput = {
      sessionId: 'session-1',
      messageId: 'message-1',
      operation,
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'git status --short' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' },
      definitionHash: 'a'.repeat(64),
      capabilityHash: 'b'.repeat(64)
    }
    const nestedOutcome: CommitNestedExecutionToolOutcomeInput = {
      sessionId: 'session-1',
      messageId: 'message-1',
      operation,
      responseText: 'clean',
      isError: false
    }

    loopPort.commitNestedDispatch(nestedDispatch)
    loopPort.commitNestedToolOutcome(nestedOutcome)

    expect(nestedExecutionJournal.commitNestedDispatch).toHaveBeenCalledWith(nestedDispatch)
    expect(nestedExecutionJournal.commitNestedToolOutcome).toHaveBeenCalledWith(nestedOutcome)
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
