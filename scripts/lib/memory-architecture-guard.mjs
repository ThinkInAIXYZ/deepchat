import path from 'node:path'
import ts from 'typescript'

const COMPOSITE_PORT_NAMES = new Set([
  'MemoryRepositoryPort',
  'MemoryAuditRepositoryPort',
  'MemoryProviderGatewayPort'
])
const LINEAGE_PROPERTY_NAMES = new Set(['source_entry_ids', 'sourceEntryIds'])
const LINEAGE_OWNER_PATTERN = /(?:source_?entry_?ids|lineage)/i
const CONTEXT_FORBIDDEN_TYPE_PATTERN =
  /\b(?:MemoryPresenterDeps|MemoryRuntimeContextOptions|Memory(?:ReadRepository|MutationRepository|AccessRepository|EmbeddingRepository|LifecycleRepository|HealthRepository|Transaction|Repository|AuditRead|AuditWrite|AuditMaintenance|AuditRepository|AgentPolicy|TextGeneration|EmbeddingGateway|ProviderControl|ProviderGateway|VectorStoreFactory|ChangeSink)Port|IMemoryVectorStore)\b/
const CONTEXT_PUBLIC_SURFACE = new Set([
  'isDisposed',
  'markDisposed',
  'abortProviderRequests',
  'captureOperationFence',
  'isOperationFenceCurrent',
  'isOperationGenerationCurrent',
  'canContinueOperation',
  'invalidateAgentOperations',
  'captureReadEpoch',
  'isReadEpochCurrent',
  'markDomainMutationCommitted',
  'cleanupAgent',
  'clearRuntimeState',
  'isEnabled',
  'isPersonaEvolutionEnabled',
  'assertSafeAgentId',
  'isManagedAgent',
  'canWriteAgentMemory',
  'canReadAgentMemory',
  'canContinueAgentMemoryTask',
  'canUseCurrentMemoryEmbedding',
  'emitChanged',
  'writeAudit',
  'resolveExtractionModel',
  'resolveConsolidationModel'
])
const TYPES_COMPAT_REEXPORTS = new Map([
  [
    './domain/types',
    new Set([
      'AgentMemoryConflictState',
      'AgentMemoryEmbeddingState',
      'AgentMemoryHealthStats',
      'AgentMemoryInsertInput',
      'AgentMemoryKind',
      'AgentMemoryLifecycleState',
      'AgentMemoryLifecycleRow',
      'AgentMemoryListOptions',
      'AgentMemoryPersonaState',
      'AgentMemoryRow',
      'AgentMemoryStatus',
      'AgentMemoryWorkingCandidateCursor',
      'ArchiveChallengerTransition',
      'ArchiveConflictTargetTransition',
      'ConsolidationScanCursor',
      'EmbeddedMemoryUpdate',
      'FailedEmbeddingUpdate',
      'FuseOptions',
      'MemoryCandidate',
      'MemoryCognitiveMaintenanceInput',
      'MemoryConflictPair',
      'MemoryConflictResolution',
      'MemoryDecisionNeighborSet',
      'MemoryDecisionQueryVectorSnapshot',
      'MemoryExtractionInput',
      'MemoryExtractionResult',
      'MemoryKeywordSearchResult',
      'MemoryKeywordSearchStrategy',
      'MemoryMaintenancePersonaResult',
      'MemoryMaintenanceReflectionResult',
      'MemoryMaintenanceStepResult',
      'MemoryManagementPage',
      'MemoryManagementPageCursor',
      'MemoryPersonaDraftResult',
      'MemoryRecallItem',
      'MemoryReflectionResult',
      'MemorySearchHit',
      'MemoryStatus',
      'MemoryTransitionTarget',
      'MemoryUpdateContext',
      'MemoryVectorMatch',
      'MemoryVectorQueryOptions',
      'MemoryVectorRecord',
      'MemoryVectorRef',
      'MemoryWriteOutcome',
      'NormalizedMemoryCandidate',
      'ResolveChallengerTransition',
      'ReviveSupersededTransition',
      'RetrievalCandidate',
      'InternalContentTransition',
      'UserContentTransition',
      'WriteMemoriesOptions'
    ])
  ],
  [
    './domain/audit',
    new Set([
      'AgentMemoryAuditActorType',
      'AgentMemoryAuditInsertInput',
      'AgentMemoryAuditRow',
      'AgentMemoryAuditStatus',
      'MemoryAuditListOptions'
    ])
  ],
  [
    './ports',
    new Set([
      'IMemoryVectorStore',
      'MemoryAuditRepositoryPort',
      'MemoryRepositoryPort',
      'MemoryRetrievalPort'
    ])
  ],
  ['@shared/contracts/events/memory.events', new Set(['MemoryUpdateReason'])],
  [
    './injection',
    new Set(['MemoryInjectionPayload', 'MemoryInjectionPort', 'MemoryInjectionResult'])
  ]
])
const TYPES_OWNED_EXPORTS = new Set([
  'MemoryPresenterDeps',
  'DEFAULT_SIMILARITY_THRESHOLD',
  'DEFAULT_RRF_K',
  'MAX_TOP_K',
  'MAX_RRF_K',
  'DEFAULT_RETRIEVAL',
  'DEFAULT_RECENCY_HALF_LIFE_MS',
  'EPISODIC_HALF_LIFE_MS',
  'REFLECTION_HALF_LIFE_MS',
  'FORGET_HALF_LIFE_MS',
  'DEFAULT_CONFIDENCE',
  'CONFIDENCE_INCREMENT',
  'CONFIDENCE_BOOST',
  'IMPORTANCE_FLOOR_COEF',
  'FTS_SIMILARITY_BASELINE'
])

function isUnder(targetPath, parentPath) {
  const target = path.resolve(targetPath)
  const parent = path.resolve(parentPath)
  return target === parent || target.startsWith(`${parent}${path.sep}`)
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function propertyNameText(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text
  }
  return null
}

function resolvedSymbolAt(node, checker) {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return null
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol
  try {
    return checker.getAliasedSymbol(symbol)
  } catch {
    return symbol
  }
}

function typeContainsRuntimeContext(type) {
  if (!type) return false
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeContainsRuntimeContext(member))
  }
  return type.getSymbol()?.getName() === 'MemoryRuntimeContext'
}

function typeContainsAgentMemoryRow(type) {
  if (!type) return false
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeContainsAgentMemoryRow(member))
  }
  const name = type.getSymbol()?.getName()
  return name === 'AgentMemoryRow' || name === 'AgentMemoryLifecycleRow'
}

function legacyMemoryStatusAccessViolations(sourceFile, checker, filePath, paths) {
  const layer = memoryLayer(filePath, paths)
  if (layer !== 'services' && layer !== 'core') return []
  const violations = []
  const reported = new Set()
  const report = (detail) => {
    if (reported.has(detail)) return
    reported.add(detail)
    violations.push(
      `[memory-canonical-state] ${relativePath(paths.root, filePath)} ${detail}; use lifecycle_state and embedding_state instead of legacy status`
    )
  }
  const checkAccess = (receiver, memberName) => {
    if (memberName !== 'status') return
    if (!typeContainsAgentMemoryRow(checker.getTypeAtLocation(receiver))) return
    report('must not access AgentMemoryRow.status')
  }
  const bindingPatternType = (pattern) => {
    const direct = checker.getTypeAtLocation(pattern)
    if (typeContainsAgentMemoryRow(direct)) return direct
    const declaration = pattern.parent
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return checker.getTypeAtLocation(declaration.initializer)
    }
    return direct
  }
  const checkLegacyStatusSymbol = (node) => {
    const symbol = resolvedSymbolAt(node, checker)
    if ((symbol?.getName() ?? propertyNameText(node)) === 'LegacyAgentMemoryStatus') {
      report('must not import LegacyAgentMemoryStatus')
    }
  }
  const rightmostEntityName = (node) => {
    let current = node
    while (current && ts.isQualifiedName(current)) current = current.right
    return current
  }
  const visit = (node) => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName ?? node.name
      checkLegacyStatusSymbol(imported)
    }
    if (ts.isExportSpecifier(node)) checkLegacyStatusSymbol(node.propertyName ?? node.name)
    if (ts.isQualifiedName(node)) checkLegacyStatusSymbol(node.right)
    if (ts.isImportTypeNode(node) && node.qualifier) {
      checkLegacyStatusSymbol(rightmostEntityName(node.qualifier))
    }
    if (ts.isPropertyAccessExpression(node)) checkAccess(node.expression, node.name.text)
    if (ts.isElementAccessExpression(node)) {
      checkAccess(node.expression, propertyNameText(node.argumentExpression))
    }
    if (ts.isObjectBindingPattern(node) && typeContainsAgentMemoryRow(bindingPatternType(node))) {
      for (const element of node.elements) {
        const memberName = propertyNameText(element.propertyName ?? element.name)
        if (memberName === 'status') report('must not destructure AgentMemoryRow.status')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

function scriptKind(filePath) {
  if (/\.(?:tsx|jsx)$/.test(filePath)) return ts.ScriptKind.TSX
  if (/\.(?:js|mjs|cjs)$/.test(filePath)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

function loadCompilerOptions(root, options = {}) {
  const configHost = options.configHost ?? ts.sys
  const configPath = options.configPath ?? ts.findConfigFile(root, configHost.fileExists, 'tsconfig.node.json')
  if (!configPath) throw new Error('tsconfig.node.json was not found')

  const config = ts.readConfigFile(configPath, configHost.readFile)
  if (config.error) throw new Error(formatDiagnostic(config.error))

  const parsed = ts.parseJsonConfigFileContent(config.config, configHost, path.dirname(configPath), {
    noEmit: true
  })
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(formatDiagnostic).join('; '))
  }
  return parsed.options
}

function createProgram(root, rootNames, virtualFiles, options = {}) {
  const compilerOptions = loadCompilerOptions(root, options)
  const host = ts.createCompilerHost(compilerOptions, true)
  const normalizedVirtualFiles = new Map(
    [...virtualFiles].map(([filePath, source]) => [path.resolve(filePath), source])
  )
  const baseFileExists = host.fileExists.bind(host)
  const baseReadFile = host.readFile.bind(host)
  const baseGetSourceFile = host.getSourceFile.bind(host)

  host.fileExists = (fileName) => normalizedVirtualFiles.has(path.resolve(fileName)) || baseFileExists(fileName)
  host.readFile = (fileName) => normalizedVirtualFiles.get(path.resolve(fileName)) ?? baseReadFile(fileName)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = normalizedVirtualFiles.get(path.resolve(fileName))
    if (source !== undefined) {
      return ts.createSourceFile(fileName, source, languageVersion, true, scriptKind(fileName))
    }
    return baseGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }

  return ts.createProgram({
    rootNames: [...new Set(rootNames.map((fileName) => path.resolve(fileName)))],
    options: compilerOptions,
    host
  })
}

function moduleSpecifiers(sourceFile) {
  const specifiers = []
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
  }
  return specifiers
}

function memoryLayer(filePath, paths) {
  if (!isUnder(filePath, paths.presenterRoot)) return null
  if (isUnder(filePath, paths.domainRoot)) return 'domain'
  if (isUnder(filePath, paths.coreRoot)) return 'core'
  if (isUnder(filePath, paths.infraRoot)) return 'infra'
  if (isUnder(filePath, paths.servicesRoot)) return 'services'
  return 'root'
}

async function checkLayerImports(filePath, sourceFile, paths, resolveImport, violations) {
  const importerLayer = memoryLayer(filePath, paths)
  if (!importerLayer) return

  for (const specifier of moduleSpecifiers(sourceFile)) {
    const resolved = await resolveImport(specifier, filePath)
    if (importerLayer === 'domain') {
      const allowed =
        (resolved && (isUnder(resolved, paths.domainRoot) || isUnder(resolved, paths.sharedRoot))) ||
        specifier === '@shared' ||
        specifier.startsWith('@shared/')
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${specifier}; domain may only import domain files and shared modules`
        )
      }
      continue
    }

    if (!resolved || !isUnder(resolved, paths.presenterRoot)) continue
    const importedLayer = memoryLayer(resolved, paths)
    if (!importedLayer) continue

    if (importerLayer === 'root') {
      if (path.resolve(filePath) === paths.facadePath) continue
      const allowed =
        importedLayer === 'domain' ||
        importedLayer === 'core' ||
        (importedLayer === 'root' && path.resolve(resolved) !== paths.facadePath)
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; only memoryPresenter/index.ts may import services, infra, or the facade entrypoint`
        )
      }
      continue
    }

    if (importerLayer === 'core') {
      const allowed =
        importedLayer === 'domain' ||
        importedLayer === 'core' ||
        paths.coreAllowedRootModules.has(path.resolve(resolved))
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; core may only import core files and root contracts`
        )
      }
      continue
    }

    if (importerLayer === 'infra') {
      const allowed =
        importedLayer === 'domain' ||
        importedLayer === 'infra' ||
        importedLayer === 'core' ||
        paths.runtimeAllowedRootModules.has(path.resolve(resolved))
      if (!allowed) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; infra must not import services or facade entrypoints`
        )
      }
      continue
    }

    if (importerLayer === 'services') {
      const sameFile = path.resolve(filePath) === path.resolve(resolved)
      if (importedLayer === 'services' && !sameFile) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; service-to-service imports must use root collaborator ports`
        )
      }
      if (importedLayer === 'infra') {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; services must depend on root port contracts, not infra concrete modules`
        )
      }
      if (importedLayer === 'root' && !paths.runtimeAllowedRootModules.has(path.resolve(resolved))) {
        violations.push(
          `[memory-presenter-layer] ${relativePath(paths.root, filePath)} -> ${relativePath(paths.root, resolved)}; services may only import root runtime contracts`
        )
      }
    }
  }
}

function referencedCompositePorts(sourceFile, checker) {
  const names = new Set()
  const visit = (node) => {
    let symbolNode = null
    if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
      symbolNode = node.propertyName ?? node.name
    } else if (ts.isTypeReferenceNode(node)) {
      symbolNode = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName
    } else if (ts.isExpressionWithTypeArguments(node)) {
      symbolNode = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression
    }
    if (symbolNode) {
      const symbol = resolvedSymbolAt(symbolNode, checker)
      const name = symbol?.getName() ?? propertyNameText(symbolNode)
      if (name && COMPOSITE_PORT_NAMES.has(name)) names.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

function allowedCompositePorts(filePath, paths) {
  const resolved = path.resolve(filePath)
  if (resolved === paths.facadePath || resolved === paths.portsPath) return COMPOSITE_PORT_NAMES
  if (resolved === paths.typesPath) {
    return new Set(['MemoryRepositoryPort', 'MemoryAuditRepositoryPort'])
  }
  if (resolved === paths.providerGatewayPath) return new Set(['MemoryProviderGatewayPort'])
  if (resolved === paths.memoryTablePath) return new Set(['MemoryRepositoryPort'])
  if (resolved === paths.auditTablePath) return new Set(['MemoryAuditRepositoryPort'])
  return new Set()
}

function contextSurfaceViolations(sourceFile, checker, filePath, paths) {
  const violations = []
  let declaresRuntimeContext = false
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== 'MemoryRuntimeContext') continue
    declaresRuntimeContext = true
    for (const member of statement.members) {
      if (ts.isConstructorDeclaration(member)) continue
      const modifiers = ts.getCombinedModifierFlags(member)
      if ((modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0) continue
      const name = propertyNameText(member.name)
      const memberType = checker.typeToString(
        checker.getTypeAtLocation(member),
        member,
        ts.TypeFormatFlags.NoTruncation
      )
      if (
        !name ||
        !CONTEXT_PUBLIC_SURFACE.has(name) ||
        ts.isPropertyDeclaration(member) ||
        CONTEXT_FORBIDDEN_TYPE_PATTERN.test(memberType)
      ) {
        violations.push(
          `[memory-context-public-surface] ${relativePath(paths.root, filePath)} exposes ${name ?? '<computed>'}${CONTEXT_FORBIDDEN_TYPE_PATTERN.test(memberType) ? ` with forbidden type ${memberType}` : ''}`
        )
      }
    }
  }
  if (path.resolve(filePath) === paths.contextPath || declaresRuntimeContext) {
    return violations
  }

  const layer = memoryLayer(filePath, paths)
  if (layer !== 'services' && layer !== 'infra') return violations
  const checkMember = (receiver, memberName) => {
    if (!memberName || CONTEXT_PUBLIC_SURFACE.has(memberName)) return
    if (typeContainsRuntimeContext(checker.getTypeAtLocation(receiver))) {
      violations.push(
        `[memory-context-escape] ${relativePath(paths.root, filePath)} accesses non-public context capability ${memberName}`
      )
    }
  }
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) checkMember(node.expression, node.name.text)
    if (ts.isElementAccessExpression(node)) {
      checkMember(node.expression, propertyNameText(node.argumentExpression))
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      typeContainsRuntimeContext(checker.getTypeAtLocation(node.initializer))
    ) {
      for (const element of node.name.elements) {
        checkMember(
          node.initializer,
          propertyNameText(element.propertyName) ?? propertyNameText(element.name)
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return violations
}

function checkTypesOwnership(sourceFile, filePath, paths) {
  if (path.resolve(filePath) !== paths.typesPath) return []
  const violations = []
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier?.text
      if (!statement.exportClause || !specifier) {
        violations.push(
          `[memory-types-owner] ${relativePath(paths.root, filePath)} must use explicit compatibility re-exports`
        )
        continue
      }
      if (!ts.isNamedExports(statement.exportClause)) continue
      const allowed = TYPES_COMPAT_REEXPORTS.get(specifier)
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text
        const sourceName = element.propertyName?.text ?? exportedName
        const canonicalRowAlias =
          specifier === './domain/types' &&
          sourceName === 'CanonicalAgentMemoryRow' &&
          exportedName === 'AgentMemoryRow'
        if ((!allowed?.has(sourceName) || exportedName !== sourceName) && !canonicalRowAlias) {
          violations.push(
            `[memory-types-owner] ${relativePath(paths.root, filePath)} must not re-export ${exportedName} from ${specifier}`
          )
        }
      }
      continue
    }

    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
    if (!exported) continue
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map((declaration) => propertyNameText(declaration.name))
      : [propertyNameText(statement.name)]
    for (const name of names) {
      if (!name || !TYPES_OWNED_EXPORTS.has(name)) {
        violations.push(
          `[memory-types-owner] ${relativePath(paths.root, filePath)} must not own exported declaration ${name ?? '<anonymous>'}`
        )
      }
    }
  }
  return violations
}

function isJsonCodecCall(node) {
  if (!ts.isCallExpression(node)) return false
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'JSON'
  ) {
    return node.expression.name.text === 'parse' || node.expression.name.text === 'stringify'
  }
  if (
    ts.isElementAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'JSON'
  ) {
    const method = propertyNameText(node.expression.argumentExpression)
    return method === 'parse' || method === 'stringify'
  }
  return false
}

function functionOwnerName(node) {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)) &&
    node.name
  ) {
    return node.name
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.name
  }
  if (
    ts.isPropertyAssignment(node) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.name
  }
  return null
}

function containsJsonCodec(node) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (isJsonCodecCall(child)) found = true
    else ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function expressionContainsLineage(node, checker, taintedSymbols) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(child) &&
      LINEAGE_PROPERTY_NAMES.has(child.name.text)
    ) {
      found = true
      return
    }
    if (
      ts.isElementAccessExpression(child) &&
      LINEAGE_PROPERTY_NAMES.has(propertyNameText(child.argumentExpression) ?? '')
    ) {
      found = true
      return
    }
    if (ts.isIdentifier(child)) {
      const symbol = checker.getSymbolAtLocation(child)
      if (LINEAGE_PROPERTY_NAMES.has(child.text) || (symbol && taintedSymbols.has(symbol))) {
        found = true
        return
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function hasLocalLineageCodec(sourceFile, checker) {
  const declarations = []
  const taintedSymbols = new Set()
  const helperSymbols = new Set()
  const helperNames = new Set()

  const collect = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) declarations.push(node)
    const ownerName = functionOwnerName(node)
    if (ownerName && containsJsonCodec(node)) {
      const symbol = checker.getSymbolAtLocation(ownerName)
      if (symbol) helperSymbols.add(symbol)
      helperNames.add(propertyNameText(ownerName) ?? '')
    }
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)

  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const symbol = checker.getSymbolAtLocation(declaration.name)
      if (!symbol || taintedSymbols.has(symbol)) continue
      const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : null
      if (
        LINEAGE_PROPERTY_NAMES.has(declaration.name.text) ||
        (initializer && expressionContainsLineage(initializer, checker, taintedSymbols))
      ) {
        taintedSymbols.add(symbol)
        changed = true
      }
    }

    const discoverHelperWrappers = (node) => {
      const ownerName = functionOwnerName(node)
      if (ownerName && !helperNames.has(propertyNameText(ownerName) ?? '')) {
        let callsHelper = false
        const inspect = (child) => {
          if (callsHelper) return
          if (ts.isCallExpression(child) && !isJsonCodecCall(child)) {
            const callee = ts.isPropertyAccessExpression(child.expression)
              ? child.expression.name
              : child.expression
            if (ts.isIdentifier(callee)) {
              const symbol = checker.getSymbolAtLocation(callee)
              if ((symbol && helperSymbols.has(symbol)) || helperNames.has(callee.text)) {
                callsHelper = true
                return
              }
            }
          }
          ts.forEachChild(child, inspect)
        }
        inspect(node)
        if (callsHelper) {
          const symbol = checker.getSymbolAtLocation(ownerName)
          if (symbol) helperSymbols.add(symbol)
          helperNames.add(propertyNameText(ownerName) ?? '')
          changed = true
        }
      }
      ts.forEachChild(node, discoverHelperWrappers)
    }
    discoverHelperWrappers(sourceFile)
  }

  let violation = false
  const inspect = (node) => {
    if (violation) return
    if (isJsonCodecCall(node)) {
      if (node.arguments.some((argument) => expressionContainsLineage(argument, checker, taintedSymbols))) {
        violation = true
        return
      }
      let owner = node.parent
      while (owner && !ts.isSourceFile(owner)) {
        const ownerName = functionOwnerName(owner)
        if (ownerName && LINEAGE_OWNER_PATTERN.test(propertyNameText(ownerName) ?? '')) {
          violation = true
          return
        }
        owner = owner.parent
      }
    }
    if (ts.isCallExpression(node) && !isJsonCodecCall(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression
      if (ts.isIdentifier(callee)) {
        const symbol = checker.getSymbolAtLocation(callee)
        const helper = (symbol && helperSymbols.has(symbol)) || helperNames.has(callee.text)
        if (
          helper &&
          node.arguments.some((argument) => expressionContainsLineage(argument, checker, taintedSymbols))
        ) {
          violation = true
          return
        }
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(sourceFile)
  return violation
}

function buildPaths(root) {
  const presenterRoot = path.join(root, 'src/main/presenter/memoryPresenter')
  const sqliteRoot = path.join(root, 'src/main/presenter/sqlitePresenter')
  return {
    root,
    presenterRoot,
    facadePath: path.join(presenterRoot, 'index.ts'),
    contextPath: path.join(presenterRoot, 'context.ts'),
    portsPath: path.join(presenterRoot, 'ports.ts'),
    typesPath: path.join(presenterRoot, 'types.ts'),
    providerGatewayPath: path.join(presenterRoot, 'infra/providerGateway.ts'),
    domainRoot: path.join(presenterRoot, 'domain'),
    coreRoot: path.join(presenterRoot, 'core'),
    infraRoot: path.join(presenterRoot, 'infra'),
    servicesRoot: path.join(presenterRoot, 'services'),
    sharedRoot: path.join(root, 'src/shared'),
    sqliteRoot,
    memoryTablePath: path.join(sqliteRoot, 'tables/agentMemory.ts'),
    auditTablePath: path.join(sqliteRoot, 'tables/agentMemoryAudit.ts'),
    sharedRoutePath: path.join(root, 'src/shared/contracts/routes/memory.routes.ts'),
    mainRoutesPath: path.join(root, 'src/main/routes/index.ts'),
    sharedLineageCodecPath: path.join(root, 'src/shared/lib/agentMemoryLineage.ts'),
    coreAllowedRootModules: new Set([
      path.join(presenterRoot, 'ports.ts'),
      path.join(presenterRoot, 'types.ts')
    ]),
    runtimeAllowedRootModules: new Set([
      path.join(presenterRoot, 'context.ts'),
      path.join(presenterRoot, 'ports.ts'),
      path.join(presenterRoot, 'runtimeConstants.ts'),
      path.join(presenterRoot, 'types.ts')
    ])
  }
}

export async function analyzeMemoryArchitecture({
  root,
  fileSet,
  readSource,
  resolveImport,
  virtualFiles = new Map(),
  compiler = {}
}) {
  const paths = buildPaths(root)
  const sources = new Map()
  const selectedFiles = []
  for (const filePath of fileSet) {
    if (!/\.[cm]?[jt]sx?$/.test(filePath)) continue
    const source = await readSource(filePath)
    sources.set(path.resolve(filePath), source)
    const resolved = path.resolve(filePath)
    const boundary =
      isUnder(resolved, paths.presenterRoot) ||
      resolved === paths.memoryTablePath ||
      resolved === paths.auditTablePath ||
      resolved === paths.sharedRoutePath ||
      resolved === paths.mainRoutesPath
    const lineageCandidate =
      /JSON\s*(?:\.|\[)\s*['"]?(?:parse|stringify)/.test(source) &&
      (/(?:source_entry_ids|sourceEntryIds|lineage)/i.test(source) ||
        source.includes('agentMemoryLineage'))
    if (boundary || lineageCandidate) selectedFiles.push(resolved)
  }

  let program
  try {
    program = createProgram(root, selectedFiles, virtualFiles, compiler)
  } catch (error) {
    return [
      `[memory-guard-program-invalid] ${error instanceof Error ? error.message : String(error)}`
    ]
  }

  const checker = program.getTypeChecker()
  const violations = []
  for (const filePath of selectedFiles) {
    const source = sources.get(filePath) ?? ''
    const sourceFile =
      program.getSourceFile(filePath) ??
      ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind(filePath))
    const layer = memoryLayer(filePath, paths)
    const isMemoryTable = filePath === paths.memoryTablePath || filePath === paths.auditTablePath

    await checkLayerImports(filePath, sourceFile, paths, resolveImport, violations)

    if (layer) {
      for (const specifier of moduleSpecifiers(sourceFile)) {
        const resolved = await resolveImport(specifier, filePath)
        if (resolved && isUnder(resolved, paths.sqliteRoot)) {
          violations.push(
            `[memory-domain-sqlite-concrete] ${relativePath(root, filePath)} -> ${relativePath(root, resolved)}`
          )
        }
      }
    }

    const allowedComposites = allowedCompositePorts(filePath, paths)
    for (const name of referencedCompositePorts(sourceFile, checker)) {
      if (!allowedComposites.has(name)) {
        violations.push(
          `[memory-composite-port] ${relativePath(root, filePath)} must not reference ${name}`
        )
      }
    }

    violations.push(...contextSurfaceViolations(sourceFile, checker, filePath, paths))
    violations.push(...legacyMemoryStatusAccessViolations(sourceFile, checker, filePath, paths))
    violations.push(...checkTypesOwnership(sourceFile, filePath, paths))

    if (isMemoryTable) {
      for (const statement of sourceFile.statements) {
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteralLike(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text.includes('memoryPresenter/domain')
        ) {
          violations.push(
            `[memory-table-domain-reexport] ${relativePath(root, filePath)} must consume domain types without re-exporting them`
          )
        }
      }
    }

    if (
      filePath !== paths.sharedLineageCodecPath &&
      (layer || isMemoryTable || filePath === paths.sharedRoutePath || filePath === paths.mainRoutesPath ||
        /(?:source_entry_ids|sourceEntryIds|lineage)/i.test(source)) &&
      hasLocalLineageCodec(sourceFile, checker)
    ) {
      violations.push(
        `[memory-lineage-codec] ${relativePath(root, filePath)} must use the shared lineage codec`
      )
    }
  }

  return violations
}
