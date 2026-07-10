import path from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MAIN_ROOT = path.resolve('src/main')
const FIXTURE_ROOT = path.resolve('test/fixtures/sessionResolutionGuard')
const LEGACY_METHODS = new Set(['getSession', 'getSessionList', 'getActiveSession'])
const PRODUCTION_ALLOWLIST = new Set([
  'src/main/presenter/floatingButtonPresenter/index.ts#loadSessions#getSessionList'
])

const toProjectPath = (file: string): string =>
  path.relative(process.cwd(), file).split(path.sep).join('/')

const createProgram = (rootNames?: string[]): ts.Program => {
  const configPath = path.resolve('tsconfig.node.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
        .join('\n')
    )
  }
  return ts.createProgram({
    rootNames: rootNames ?? parsed.fileNames,
    options: rootNames ? { ...parsed.options, composite: false, noEmit: true } : parsed.options
  })
}

const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

const staticName = (name: ts.PropertyName | undefined): string | null => {
  if (name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))) {
    return name.text
  }
  return null
}

const elementName = (node: ts.ElementAccessExpression): string | null => {
  const argument = node.argumentExpression && unwrap(node.argumentExpression)
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null
}

const hasPresenterShape = (type: ts.Type): boolean => {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) {
    return false
  }
  if (type.isUnionOrIntersection()) {
    return type.types.some(hasPresenterShape)
  }
  return ['resolveSession', 'resolveSessionList', 'resolveActiveSession'].every((method) =>
    type.getProperty(method)
  )
}

const isPresenterExpression = (
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: ReadonlySet<ts.Symbol> = new Set()
): boolean => {
  const current = unwrap(expression)
  if (hasPresenterShape(checker.getTypeAtLocation(current))) {
    return true
  }
  if (
    (ts.isPropertyAccessExpression(current) && current.name.text === 'agentSessionPresenter') ||
    (ts.isElementAccessExpression(current) && elementName(current) === 'agentSessionPresenter')
  ) {
    return true
  }
  if (ts.isIdentifier(current)) {
    const symbol = checker.getSymbolAtLocation(current)
    if (!symbol || seen.has(symbol)) {
      return false
    }
    const nextSeen = new Set(seen).add(symbol)
    return Boolean(
      symbol.declarations?.some((declaration) => {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
          return isPresenterExpression(declaration.initializer, checker, nextSeen)
        }
        return (
          ts.isBindingElement(declaration) &&
          staticName(declaration.propertyName ?? declaration.name) === 'agentSessionPresenter'
        )
      })
    )
  }
  if (ts.isConditionalExpression(current)) {
    return (
      isPresenterExpression(current.whenTrue, checker, seen) ||
      isPresenterExpression(current.whenFalse, checker, seen)
    )
  }
  if (
    ts.isBinaryExpression(current) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken
    ].includes(current.operatorToken.kind)
  ) {
    return (
      isPresenterExpression(current.left, checker, seen) ||
      isPresenterExpression(current.right, checker, seen)
    )
  }
  return false
}

const ownerName = (node: ts.Node): string => {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return staticName(current.name) ?? '<computed-owner>'
    }
    if (ts.isFunctionDeclaration(current)) {
      return current.name?.text ?? '<anonymous-function>'
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text
    }
  }
  return '<module>'
}

const scanLegacyReferences = (program: ts.Program, sourceFiles: ts.SourceFile[]): string[] => {
  const checker = program.getTypeChecker()
  const references = new Set<string>()
  const record = (node: ts.Node, method: string): void => {
    references.add(`${toProjectPath(node.getSourceFile().fileName)}#${ownerName(node)}#${method}`)
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      LEGACY_METHODS.has(node.name.text) &&
      isPresenterExpression(node.expression, checker)
    ) {
      record(node, node.name.text)
    } else if (
      ts.isElementAccessExpression(node) &&
      isPresenterExpression(node.expression, checker)
    ) {
      const method = elementName(node)
      if (method === null || LEGACY_METHODS.has(method)) {
        record(node, method ?? '<computed-access>')
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isPresenterExpression(node.initializer, checker)
    ) {
      for (const element of node.name.elements) {
        const method = staticName(element.propertyName ?? element.name)
        if (method === null || LEGACY_METHODS.has(method)) {
          record(element, method ?? '<computed-destructure>')
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  sourceFiles.forEach(visit)
  return [...references].sort()
}

const sourceFilesUnder = (program: ts.Program, root: string): ts.SourceFile[] =>
  program
    .getSourceFiles()
    .filter((sourceFile) => path.resolve(sourceFile.fileName).startsWith(`${root}${path.sep}`))

describe('session resolution source contract', () => {
  it('keeps only the exact floating-button boundary on a production legacy adapter', () => {
    const program = createProgram()
    const sourceFiles = sourceFilesUnder(program, MAIN_ROOT)
    const references = scanLegacyReferences(program, sourceFiles)

    expect(references.filter((reference) => PRODUCTION_ALLOWLIST.has(reference))).toEqual([
      ...PRODUCTION_ALLOWLIST
    ])
    expect(references.filter((reference) => !PRODUCTION_ALLOWLIST.has(reference))).toEqual([])
  })

  it('catches aliased legacy references but ignores unrelated same-name methods', () => {
    const program = createProgram([
      path.join(FIXTURE_ROOT, 'positive.ts'),
      path.join(FIXTURE_ROOT, 'negative.ts')
    ])
    const references = scanLegacyReferences(program, sourceFilesUnder(program, FIXTURE_ROOT))

    expect(references).toEqual([
      'test/fixtures/sessionResolutionGuard/positive.ts#aliasedReference#getSessionList',
      'test/fixtures/sessionResolutionGuard/positive.ts#boundReference#getSession',
      'test/fixtures/sessionResolutionGuard/positive.ts#computedReference#<computed-access>',
      'test/fixtures/sessionResolutionGuard/positive.ts#destructuredReference#getActiveSession',
      'test/fixtures/sessionResolutionGuard/positive.ts#destructuredRootReference#getSession',
      'test/fixtures/sessionResolutionGuard/positive.ts#directReference#getSession',
      'test/fixtures/sessionResolutionGuard/positive.ts#typedReference#getSessionList'
    ])
  })

  it('does not fake a nullable session into SessionWithState', () => {
    const program = createProgram()
    const violations = sourceFilesUnder(program, MAIN_ROOT)
      .filter((sourceFile) => /null\s+as\s+unknown\s+as\s+SessionWithState/.test(sourceFile.text))
      .map((sourceFile) => toProjectPath(sourceFile.fileName))

    expect(violations).toEqual([])
  })
})
