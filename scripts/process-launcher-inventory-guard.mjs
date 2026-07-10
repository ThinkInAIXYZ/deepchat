import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx', '.vue'])
const CHILD_PROCESS_METHODS = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync'
])
const ELECTRON_SHELL_ALLOWED_UNTRACKED_METHODS = new Set(['showItemInFolder'])
const CATEGORIES = new Set([
  'deepchat-runtime',
  'external-opener',
  'helper',
  'synchronous-exclusion',
  'termination-helper',
  'user-owned-external',
  'utility-host'
])
const DEFAULT_INVENTORY_PATH = 'scripts/process-launcher-inventory.json'
const WATCHED_MODULES = new Set([
  '@modelcontextprotocol/sdk/client/stdio.js',
  'child_process',
  'cross-spawn',
  'electron',
  'node-pty',
  'node:child_process'
])

function getConfiguredPaths() {
  const testRoot = process.env.DEEPCHAT_TEST_PROCESS_LAUNCHER_ROOT
  const testInventory = process.env.DEEPCHAT_TEST_PROCESS_LAUNCHER_INVENTORY
  const allowTestOverride = process.env.NODE_ENV === 'test'
  const root = allowTestOverride && testRoot ? path.resolve(testRoot) : process.cwd()
  const inventoryPath =
    allowTestOverride && testInventory
      ? path.resolve(testInventory)
      : path.join(root, DEFAULT_INVENTORY_PATH)

  return { inventoryPath, root }
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

async function collectSourceFiles(entryPath) {
  const entries = await fs.readdir(entryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const nextPath = path.join(entryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(nextPath)))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(nextPath)
    }
  }

  return files
}

function getModuleName(node) {
  if (!node) return null
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

function createSourceUnits(filePath, source) {
  if (path.extname(filePath) !== '.vue') {
    return [
      {
        offset: 0,
        sourceFile: ts.createSourceFile(
          filePath,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX
        )
      }
    ]
  }

  const units = []
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  let match
  while ((match = scriptPattern.exec(source)) !== null) {
    const script = match[1]
    units.push({
      offset: match.index + match[0].indexOf(script),
      sourceFile: ts.createSourceFile(
        filePath,
        script,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
    })
  }
  return units
}

function addFunctionBinding(bindings, local, launcher) {
  if (/^[A-Za-z_$][\w$]*$/.test(local)) bindings.set(local, launcher)
}

function extractBindings(sourceUnits) {
  const functionBindings = new Map()
  const namespaceBindings = new Map()
  const electronShellBindings = new Set()
  const electronUtilityBindings = new Set()
  const stdioTransportBindings = new Set()
  const unsupportedSyntax = []
  const promisifyBindings = []
  const allowedBindingUses = new Set()

  const addUnsupported = (unit, node, module, syntax) => {
    unsupportedSyntax.push({
      index: unit.offset + node.getStart(unit.sourceFile),
      module,
      syntax
    })
  }

  const addStaticImport = (unit, node, module) => {
    const clause = node.importClause
    if (!clause || clause.isTypeOnly) return

    const defaultImport = clause.name?.text ?? null
    const namespace = clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)
      ? clause.namedBindings.name.text
      : null
    const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements
          .filter((entry) => !entry.isTypeOnly)
          .map((entry) => ({
            imported: (entry.propertyName ?? entry.name).text,
            local: entry.name.text
          }))
      : []

    if (module === 'child_process' || module === 'node:child_process') {
      for (const { imported, local } of named) {
        if (CHILD_PROCESS_METHODS.has(imported)) {
          addFunctionBinding(functionBindings, local, `child_process.${imported}`)
        }
      }
      if (namespace) namespaceBindings.set(namespace, 'child_process')
      if (defaultImport) {
        namespaceBindings.set(defaultImport, 'child_process')
      }
    } else if (module === 'cross-spawn') {
      if (defaultImport) {
        addFunctionBinding(functionBindings, defaultImport, 'cross-spawn.spawn')
        namespaceBindings.set(defaultImport, 'cross-spawn-default')
      }
      for (const { imported, local } of named) {
        if (imported === 'sync') addFunctionBinding(functionBindings, local, 'cross-spawn.sync')
      }
      if (namespace) namespaceBindings.set(namespace, 'cross-spawn')
    } else if (module === 'node-pty') {
      for (const { imported, local } of named) {
        if (imported === 'spawn') addFunctionBinding(functionBindings, local, 'node-pty.spawn')
      }
      if (namespace) namespaceBindings.set(namespace, 'node-pty')
      if (defaultImport) namespaceBindings.set(defaultImport, 'node-pty')
    } else if (module === 'electron') {
      if (defaultImport || namespace || named.some(({ imported }) => imported === 'default')) {
        addUnsupported(unit, node, module, 'default/namespace import')
        return
      }
      for (const { imported, local } of named) {
        if (imported === 'shell') electronShellBindings.add(local)
        if (imported === 'utilityProcess') electronUtilityBindings.add(local)
      }
    } else if (module === '@modelcontextprotocol/sdk/client/stdio.js') {
      if (defaultImport || namespace || named.some(({ imported }) => imported === 'default')) {
        addUnsupported(unit, node, module, 'default/namespace import')
        return
      }
      for (const { imported, local } of named) {
        if (imported === 'StdioClientTransport') stdioTransportBindings.add(local)
      }
    }
  }

  const addDynamicElectronImport = (unit, node) => {
    if (node.arguments.length !== 1) return false
    const initializer = ts.isAwaitExpression(node.parent) ? node.parent : node
    const declaration = initializer.parent
    if (
      !ts.isVariableDeclaration(declaration) ||
      declaration.initializer !== initializer ||
      !ts.isObjectBindingPattern(declaration.name) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) {
      return false
    }

    const bindings = []
    for (const element of declaration.name.elements) {
      if (
        element.dotDotDotToken ||
        element.initializer ||
        !ts.isIdentifier(element.name) ||
        (element.propertyName && !ts.isIdentifier(element.propertyName))
      ) {
        return false
      }
      bindings.push({
        imported: (element.propertyName ?? element.name).text,
        local: element.name.text
      })
    }
    if (bindings.some(({ imported }) => imported === 'default')) return false

    for (const { imported, local } of bindings) {
      if (imported === 'shell') electronShellBindings.add(local)
      if (imported === 'utilityProcess') electronUtilityBindings.add(local)
    }
    return true
  }

  for (const unit of sourceUnits) {
    const visit = (node) => {
      if (ts.isImportDeclaration(node)) {
        const module = getModuleName(node.moduleSpecifier)
        if (WATCHED_MODULES.has(module)) addStaticImport(unit, node, module)
      } else if (ts.isImportEqualsDeclaration(node)) {
        const module = ts.isExternalModuleReference(node.moduleReference)
          ? getModuleName(node.moduleReference.expression)
          : null
        if (!node.isTypeOnly && WATCHED_MODULES.has(module)) {
          addUnsupported(unit, node, module, 'CommonJS require')
        }
      } else if (ts.isExportDeclaration(node)) {
        const module = node.moduleSpecifier ? getModuleName(node.moduleSpecifier) : null
        const typeOnly =
          node.isTypeOnly ||
          (node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((entry) => entry.isTypeOnly))
        if (!typeOnly && WATCHED_MODULES.has(module)) {
          addUnsupported(unit, node, module, 'launcher re-export')
        }
      } else if (ts.isCallExpression(node)) {
        const module = node.arguments[0] ? getModuleName(node.arguments[0]) : null
        if (!WATCHED_MODULES.has(module)) {
          ts.forEachChild(node, visit)
          return
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          addUnsupported(unit, node, module, 'CommonJS require')
        } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          if (module !== 'electron' || !addDynamicElectronImport(unit, node)) {
            addUnsupported(unit, node, module, 'dynamic import')
          }
        } else {
          addUnsupported(unit, node, module, 'opaque module loader')
        }
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'promisify' &&
        node.initializer.arguments.length === 1 &&
        ts.isIdentifier(node.initializer.arguments[0])
      ) {
        promisifyBindings.push({
          local: node.name.text,
          target: node.initializer.arguments[0].text,
          targetNode: node.initializer.arguments[0]
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(unit.sourceFile)
  }

  for (const { local, target, targetNode } of promisifyBindings) {
    const launcher = functionBindings.get(target)
    if (launcher) {
      addFunctionBinding(functionBindings, local, launcher)
      allowedBindingUses.add(targetNode)
    }
  }

  return {
    electronShellBindings,
    electronUtilityBindings,
    functionBindings,
    namespaceBindings,
    stdioTransportBindings,
    unsupportedSyntax,
    allowedBindingUses
  }
}

function moduleForLauncher(launcher) {
  if (launcher.startsWith('child_process.')) return 'child_process'
  if (launcher.startsWith('cross-spawn.')) return 'cross-spawn'
  if (launcher.startsWith('node-pty.')) return 'node-pty'
  if (launcher.startsWith('electron.')) return 'electron'
  return '@modelcontextprotocol/sdk/client/stdio.js'
}

function getStaticMemberAccess(expression) {
  const member = ts.skipParentheses(expression)
  if (ts.isPropertyAccessExpression(member)) {
    const object = ts.skipParentheses(member.expression)
    return ts.isIdentifier(object) ? { method: member.name.text, object } : null
  }
  if (ts.isElementAccessExpression(member)) {
    const object = ts.skipParentheses(member.expression)
    const method = getModuleName(member.argumentExpression)
    return ts.isIdentifier(object) && method ? { method, object } : null
  }
  return null
}

function detectLaunches(filePath, source) {
  const sourceUnits = createSourceUnits(filePath, source)
  const bindings = extractBindings(sourceUnits)
  const matches = []
  const allowedBindingUses = new Set(bindings.allowedBindingUses)

  const getCallLauncher = (expression) => {
    const target = ts.skipParentheses(expression)
    if (ts.isIdentifier(target)) {
      const launcher = bindings.functionBindings.get(target.text)
      return launcher ? { bindingNode: target, launcher } : null
    }

    const member = getStaticMemberAccess(target)
    if (!member) return null
    const local = member.object.text
    const method = member.method
    let launcher = null
    if (bindings.electronShellBindings.has(local)) {
      if (ELECTRON_SHELL_ALLOWED_UNTRACKED_METHODS.has(method)) {
        return { bindingNode: member.object, launcher: null }
      }
      launcher = method === 'openExternal' || method === 'openPath'
        ? `electron.shell.${method}`
        : null
    } else if (bindings.electronUtilityBindings.has(local)) {
      launcher = method === 'fork' ? 'electron.utilityProcess.fork' : null
    } else if (bindings.namespaceBindings.get(local) === 'child_process') {
      launcher = CHILD_PROCESS_METHODS.has(method) ? `child_process.${method}` : null
    } else if (bindings.namespaceBindings.get(local) === 'node-pty') {
      launcher = method === 'spawn' ? 'node-pty.spawn' : null
    } else if (
      bindings.namespaceBindings.get(local) === 'cross-spawn' ||
      bindings.namespaceBindings.get(local) === 'cross-spawn-default'
    ) {
      launcher = method === 'sync'
        ? 'cross-spawn.sync'
        : bindings.namespaceBindings.get(local) === 'cross-spawn' && method === 'spawn'
          ? 'cross-spawn.spawn'
          : null
    }
    return launcher ? { bindingNode: member.object, launcher } : null
  }

  for (const unit of sourceUnits) {
    const visit = (node) => {
      let launcher = null
      let bindingNode = null
      if (ts.isCallExpression(node)) {
        const call = getCallLauncher(node.expression)
        launcher = call?.launcher ?? null
        bindingNode = call?.bindingNode ?? null
      } else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(ts.skipParentheses(node.expression)) &&
        bindings.stdioTransportBindings.has(ts.skipParentheses(node.expression).text)
      ) {
        launcher = 'mcp.StdioClientTransport'
        bindingNode = ts.skipParentheses(node.expression)
      }
      if (bindingNode) allowedBindingUses.add(bindingNode)
      if (launcher) {
        matches.push({
          index: unit.offset + node.expression.getStart(unit.sourceFile),
          launcher
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(unit.sourceFile)
  }

  const bindingNames = new Set([
    ...bindings.functionBindings.keys(),
    ...bindings.namespaceBindings.keys(),
    ...bindings.electronShellBindings,
    ...bindings.electronUtilityBindings,
    ...bindings.stdioTransportBindings
  ])
  const getBindingModule = (name) => {
    const launcher = bindings.functionBindings.get(name)
    if (launcher) return moduleForLauncher(launcher)
    const namespace = bindings.namespaceBindings.get(name)
    if (namespace) return namespace === 'cross-spawn-default' ? 'cross-spawn' : namespace
    if (bindings.electronShellBindings.has(name) || bindings.electronUtilityBindings.has(name)) {
      return 'electron'
    }
    return '@modelcontextprotocol/sdk/client/stdio.js'
  }
  const isInstanceofOperand = (node) => {
    let expression = node
    while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent
    return (
      ts.isBinaryExpression(expression.parent) &&
      expression.parent.right === expression &&
      expression.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    )
  }
  const isRuntimeExportReference = (node) => {
    if (!ts.isExportSpecifier(node.parent)) return false
    const declaration = node.parent.parent.parent
    if (
      !ts.isExportDeclaration(declaration) ||
      declaration.isTypeOnly ||
      node.parent.isTypeOnly
    ) {
      return false
    }
    return node.parent.propertyName ? node.parent.propertyName === node : node.parent.name === node
  }

  for (const unit of sourceUnits) {
    const visit = (node) => {
      const runtimeReference =
        ts.isIdentifier(node) &&
        (ts.isShorthandPropertyAssignment(node.parent) || isRuntimeExportReference(node))
      if (
        ts.isIdentifier(node) &&
        bindingNames.has(node.text) &&
        !allowedBindingUses.has(node) &&
        (!ts.isDeclarationName(node) || runtimeReference) &&
        !ts.isPartOfTypeNode(node) &&
        !isInstanceofOperand(node) &&
        !(ts.isBindingElement(node.parent) && node.parent.propertyName === node) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      ) {
        bindings.unsupportedSyntax.push({
          index: unit.offset + node.getStart(unit.sourceFile),
          module: getBindingModule(node.text),
          syntax: 'opaque launcher binding use'
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(unit.sourceFile)
  }

  const uniqueMatches = new Map()
  for (const match of matches) uniqueMatches.set(`${match.index}:${match.launcher}`, match)
  return {
    matches: [...uniqueMatches.values()].sort((left, right) => left.index - right.index),
    unsupportedSyntax: bindings.unsupportedSyntax
  }
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length
}

async function scanLaunchers(root) {
  const sourceRoot = path.join(root, 'src')
  const files = await collectSourceFiles(sourceRoot)
  const sites = []
  const unsupportedSyntax = []

  for (const filePath of files.sort()) {
    const source = await fs.readFile(filePath, 'utf8')
    const occurrences = new Map()
    const relativePath = toPosix(path.relative(root, filePath))

    const detection = detectLaunches(filePath, source)
    for (const match of detection.unsupportedSyntax) {
      unsupportedSyntax.push({
        ...match,
        line: lineForIndex(source, match.index),
        path: relativePath
      })
    }

    for (const match of detection.matches) {
      const occurrence = (occurrences.get(match.launcher) ?? 0) + 1
      occurrences.set(match.launcher, occurrence)
      sites.push({
        launcher: match.launcher,
        line: lineForIndex(source, match.index),
        occurrence,
        path: relativePath
      })
    }
  }

  return { sites, unsupportedSyntax }
}

function siteId(site) {
  return `${site.path}|${site.launcher}|${site.occurrence}`
}

function validateInventory(inventory) {
  const errors = []
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return ['inventory must be an object']
  }
  if (inventory.version !== 1) errors.push('version must be 1')
  if (!Array.isArray(inventory.entries)) return [...errors, 'entries must be an array']

  const seen = new Set()
  for (const [index, entry] of inventory.entries.entries()) {
    const prefix = `entries[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    if (typeof entry.path !== 'string' || !entry.path.startsWith('src/')) {
      errors.push(`${prefix}.path must be a repository-relative src/ path`)
    }
    if (typeof entry.launcher !== 'string' || entry.launcher.length === 0) {
      errors.push(`${prefix}.launcher must be a non-empty string`)
    }
    if (!Number.isInteger(entry.occurrence) || entry.occurrence < 1) {
      errors.push(`${prefix}.occurrence must be a positive integer`)
    }
    if (typeof entry.owner !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.owner)) {
      errors.push(`${prefix}.owner must be a kebab-case identifier`)
    }
    if (!CATEGORIES.has(entry.category)) {
      errors.push(`${prefix}.category must be one of: ${[...CATEGORIES].join(', ')}`)
    }

    if (
      typeof entry.path === 'string' &&
      typeof entry.launcher === 'string' &&
      Number.isInteger(entry.occurrence)
    ) {
      const id = siteId(entry)
      if (seen.has(id)) errors.push(`${prefix} duplicates ${id}`)
      seen.add(id)
    }
  }

  return errors
}

async function main() {
  const { inventoryPath, root } = getConfiguredPaths()
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'))
  const inventoryErrors = validateInventory(inventory)
  if (inventoryErrors.length > 0) {
    for (const error of inventoryErrors) {
      console.error(`[process-launcher-inventory-invalid] ${error}`)
    }
    process.exitCode = 1
    return
  }

  const { sites: detectedSites, unsupportedSyntax } = await scanLaunchers(root)
  const detectedById = new Map(detectedSites.map((site) => [siteId(site), site]))
  const expectedById = new Map(inventory.entries.map((entry) => [siteId(entry), entry]))
  const violations = unsupportedSyntax.map(
    (match) =>
      `[process-launcher-unsupported-syntax] ${match.path}:${match.line} ${match.syntax} for ${match.module}`
  )

  for (const site of detectedSites) {
    if (!expectedById.has(siteId(site))) {
      violations.push(
        `[process-launcher-unclassified] ${site.path}:${site.line} ${site.launcher}#${site.occurrence} has no owner/category`
      )
    }
  }

  for (const entry of inventory.entries) {
    if (!detectedById.has(siteId(entry))) {
      violations.push(
        `[process-launcher-inventory-drift] missing ${entry.path} ${entry.launcher}#${entry.occurrence} owner=${entry.owner} category=${entry.category}`
      )
    }
  }

  if (violations.length > 0) {
    for (const violation of violations.sort()) console.error(violation)
    process.exitCode = 1
    return
  }

  console.log(`Process launcher inventory guard passed (${detectedSites.length} classified sites).`)
}

main().catch((error) => {
  console.error(
    `[process-launcher-inventory-error] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
