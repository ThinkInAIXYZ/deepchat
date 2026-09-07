import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const REPOSITORY_ROOT = process.cwd()
const RENDERER_ROOT = path.join(REPOSITORY_ROOT, 'src/renderer')
const FORBIDDEN_MODIFIERS = new Set(['prevent', 'stop'])
const ALERT_DIALOG_CLOSE_TAG =
  /<AlertDialog(?:Action|Cancel)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g
const CLICK_DIRECTIVE =
  /(?:^|\s)(?:@click|v-on:click)((?:\.[A-Za-z0-9_-]+)+)(?=\s|=|\/?>)/g
const CLICK_HANDLER =
  /(?:^|\s)(?:@click|v-on:click)(?:\.[A-Za-z0-9_-]+)*\s*=\s*(["'])(.*?)\1/gs
const BOUND_CLICK_HANDLER =
  /(?:^|\s)(?::onClick|v-bind:onClick)\s*=\s*(["'])(.*?)\1/gs
const DYNAMIC_EVENT_LISTENER =
  /(?:^|\s)(?:@\[[^\s=/>]+\]|v-on:\[[^\s=/>]+\])(?:\.[A-Za-z0-9_-]+)*(?=\s|=|\/?>)/g
const OPAQUE_LISTENER_BAG = /(?:^|\s)(?:v-bind|v-on)\s*=\s*(["']).*?\1/gs
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/g

function lineNumberAt(source, offset) {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1
  }
  return line
}

export function findForbiddenAlertDialogClickModifiers(source) {
  const violations = []

  for (const tagMatch of source.matchAll(ALERT_DIALOG_CLOSE_TAG)) {
    const tag = tagMatch[0]
    const component = tag.startsWith('<AlertDialogCancel')
      ? 'AlertDialogCancel'
      : 'AlertDialogAction'

    for (const directiveMatch of tag.matchAll(CLICK_DIRECTIVE)) {
      const modifiers = directiveMatch[1]
        .split('.')
        .filter((modifier) => FORBIDDEN_MODIFIERS.has(modifier))
      for (const modifier of modifiers) {
        violations.push({
          component,
          modifier,
          line: lineNumberAt(source, (tagMatch.index ?? 0) + (directiveMatch.index ?? 0))
        })
      }
    }
  }

  return violations
}

function scriptBlocks(source) {
  return Array.from(source.matchAll(SCRIPT_BLOCK), (match) => ({
    source: match[1],
    offset: (match.index ?? 0) + match[0].indexOf(match[1])
  }))
}

function hasAsyncModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false
}

function collectAsyncFunctionNames(blocks) {
  const names = new Set()

  for (const block of blocks) {
    const sourceFile = ts.createSourceFile(
      'component.ts',
      block.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && hasAsyncModifier(node)) {
        names.add(node.name.text)
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
        hasAsyncModifier(node.initializer)
      ) {
        names.add(node.name.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return names
}

function containsInlineAsyncFunction(expression) {
  const sourceFile = ts.createSourceFile(
    'handler.ts',
    expression,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  let found = false
  const visit = (node) => {
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      hasAsyncModifier(node)
    ) {
      found = true
      return
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function referencedAsyncHandler(expression, asyncFunctionNames) {
  if (containsInlineAsyncFunction(expression)) return '<inline>'
  for (const name of asyncFunctionNames) {
    if (new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`).test(expression)) return name
  }
  return null
}

function maskQuotedTagValues(tag) {
  let quote = null
  let masked = ''
  for (const character of tag) {
    if (quote) {
      if (character === quote) {
        quote = null
        masked += character
      } else {
        masked += character === '\n' ? '\n' : ' '
      }
    } else {
      if (character === '"' || character === "'") quote = character
      masked += character
    }
  }
  return masked
}

function propertyNameText(name) {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

function findRenderFunctionViolations(source, blocks, asyncFunctionNames) {
  const violations = []

  for (const block of blocks) {
    const sourceFile = ts.createSourceFile(
      'component.ts',
      block.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'h' &&
        node.arguments.length > 0 &&
        ts.isIdentifier(node.arguments[0]) &&
        (node.arguments[0].text === 'AlertDialogAction' ||
          node.arguments[0].text === 'AlertDialogCancel')
      ) {
        const component = node.arguments[0].text
        const props = node.arguments[1]
        const line = lineNumberAt(source, block.offset + node.getStart(sourceFile))
        if (props && props.kind !== ts.SyntaxKind.NullKeyword) {
          if (!ts.isObjectLiteralExpression(props)) {
            violations.push({ component, reason: 'dynamic-render-props', line })
          } else {
            for (const property of props.properties) {
              if (ts.isSpreadAssignment(property)) {
                violations.push({ component, reason: 'dynamic-render-props', line })
                continue
              }
              if (propertyNameText(property.name) !== 'onClick') continue
              let handler = null
              let dynamic = false
              if (ts.isMethodDeclaration(property)) {
                handler = hasAsyncModifier(property) ? '<inline>' : null
              } else if (ts.isShorthandPropertyAssignment(property)) {
                handler = asyncFunctionNames.has(property.name.text) ? property.name.text : null
              } else if (ts.isPropertyAssignment(property)) {
                const initializer = property.initializer
                if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
                  handler = hasAsyncModifier(initializer) ? '<inline>' : null
                } else if (ts.isIdentifier(initializer)) {
                  handler = asyncFunctionNames.has(initializer.text) ? initializer.text : null
                } else {
                  dynamic = true
                }
              } else {
                dynamic = true
              }
              if (handler) {
                violations.push({ component, reason: 'async-handler', handler, line })
              } else if (dynamic) {
                violations.push({ component, reason: 'dynamic-render-handler', line })
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return violations
}

export function findNonSynchronousAlertDialogClickHandlers(source) {
  const violations = []
  const blocks = scriptBlocks(source)
  const asyncFunctionNames = collectAsyncFunctionNames(blocks)

  for (const tagMatch of source.matchAll(ALERT_DIALOG_CLOSE_TAG)) {
    const tag = tagMatch[0]
    const component = tag.startsWith('<AlertDialogCancel')
      ? 'AlertDialogCancel'
      : 'AlertDialogAction'
    const tagOffset = tagMatch.index ?? 0

    for (const binding of [CLICK_HANDLER, BOUND_CLICK_HANDLER]) {
      for (const handlerMatch of tag.matchAll(binding)) {
        const handler = referencedAsyncHandler(handlerMatch[2], asyncFunctionNames)
        if (handler) {
          violations.push({
            component,
            reason: 'async-handler',
            handler,
            line: lineNumberAt(source, tagOffset + (handlerMatch.index ?? 0))
          })
        }
      }
    }

    const tagWithoutValues = maskQuotedTagValues(tag)
    for (const binding of tagWithoutValues.matchAll(DYNAMIC_EVENT_LISTENER)) {
      violations.push({
        component,
        reason: 'dynamic-template-listener',
        line: lineNumberAt(source, tagOffset + (binding.index ?? 0))
      })
    }

    const opaqueBinding = tag.match(OPAQUE_LISTENER_BAG)
    if (opaqueBinding) {
      violations.push({
        component,
        reason: 'opaque-listener-bag',
        line: lineNumberAt(source, tagOffset + (opaqueBinding.index ?? 0))
      })
    }
  }

  violations.push(...findRenderFunctionViolations(source, blocks, asyncFunctionNames))
  return violations
}

async function listVueFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listVueFiles(filePath)))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(filePath)
    }
  }

  return files
}

export async function findAlertDialogContractViolations(root = RENDERER_ROOT) {
  const violations = []
  const files = await listVueFiles(root)

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8')
    for (const violation of findForbiddenAlertDialogClickModifiers(source)) {
      violations.push({
        kind: 'modifier',
        ...violation,
        file: path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join('/')
      })
    }
    for (const violation of findNonSynchronousAlertDialogClickHandlers(source)) {
      violations.push({
        kind: 'handler',
        ...violation,
        file: path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join('/')
      })
    }
  }

  return violations
}

async function main() {
  const violations = await findAlertDialogContractViolations()
  if (violations.length > 0) {
    console.error('Alert dialog contract guard failed.')
    for (const violation of violations) {
      if (violation.kind === 'modifier') {
        console.error(
          `- ${violation.file}:${violation.line} ${violation.component} may not use .${violation.modifier}`
        )
      } else if (violation.reason === 'async-handler') {
        console.error(
          `- ${violation.file}:${violation.line} ${violation.component} may not call async handler ${violation.handler}`
        )
      } else {
        console.error(
          `- ${violation.file}:${violation.line} ${violation.component} has an uninspectable click binding`
        )
      }
    }
    console.error(
      'Use AlertDialogAsyncAction for async confirmation, or synchronously retain the target before closing.'
    )
    process.exit(1)
  }

  console.log('Alert dialog contract guard passed.')
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMainModule) {
  main().catch((error) => {
    console.error('Alert dialog contract guard failed to run:', error)
    process.exit(1)
  })
}
