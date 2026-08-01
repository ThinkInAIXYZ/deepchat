import { parse, type Node } from 'acorn'
import {
  WORKFLOW_AUTHORING_HELPERS,
  isWorkflowAuthoringHelperName,
  type WorkflowAuthoringHelperName
} from '@shared/workflow/authoringContract'

const STRICT_MODE_PREFIX = "'use strict';\n"

const INJECTED_GLOBALS = new Set([
  'agent',
  'parallel',
  'pipeline',
  'mapLimit',
  'phase',
  'log',
  'Promise',
  'Date',
  'performance',
  'eval',
  'Function'
])
const UNSUPPORTED_PROMISE_METHODS = new Set(['then', 'catch', 'finally', 'race', 'any'])

export class WorkflowSourceValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_JAVASCRIPT' | 'UNSUPPORTED_CONSTRUCT' | 'INVALID_HELPER_CALL' =
      'UNSUPPORTED_CONSTRUCT',
    readonly helper: WorkflowAuthoringHelperName | null = null,
    readonly line: number | null = null,
    readonly column: number | null = null
  ) {
    super(message)
    this.name = 'WorkflowSourceValidationError'
  }
}

export function validateWorkflowSource(source: string): Node {
  let root: Node
  try {
    root = parse(`${STRICT_MODE_PREFIX}${source}`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true
    })
  } catch (error) {
    throw new WorkflowSourceValidationError(
      error instanceof Error
        ? normalizeStrictModeLocation(error.message)
        : 'Workflow source is not valid JavaScript.',
      'INVALID_JAVASCRIPT'
    )
  }

  walkNode(root, (node) => {
    if (node.type === 'ImportExpression') {
      reject('Dynamic import is unavailable.')
    }
    if (node.type === 'NewExpression') {
      const callee = readIdentifier(node, 'callee')
      if (callee === 'Promise' || callee === 'Function') {
        reject(`Direct ${callee} construction is unavailable.`)
      }
    }
    if (node.type === 'CallExpression') {
      const callee = readNode(node, 'callee')
      const calleeName = callee?.type === 'Identifier' ? readString(callee, 'name') : null
      if (calleeName === 'eval' || calleeName === 'Function') {
        reject(`Dynamic ${calleeName} calls are unavailable.`)
      }
      if (callee?.type === 'MemberExpression') {
        const propertyName = readStaticPropertyName(callee)
        if (propertyName && UNSUPPORTED_PROMISE_METHODS.has(propertyName)) {
          reject(`Direct .${propertyName}() promise scheduling is unavailable.`)
        }
      }
    }
    if (node.type === 'AssignmentExpression') {
      assertMutationTargetAllowed(readNode(node, 'left'))
    }
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const target = readNode(node, 'left')
      if (target?.type !== 'VariableDeclaration') {
        assertMutationTargetAllowed(target)
      }
    }
    if (node.type === 'UpdateExpression' || node.type === 'UnaryExpression') {
      if (node.type === 'UnaryExpression' && readString(node, 'operator') !== 'delete') {
        return
      }
      assertMutationTargetAllowed(readNode(node, 'argument'))
    }
  })
  validateWorkflowHelperCalls(root)
  return root
}

function validateWorkflowHelperCalls(root: Node): void {
  const shadowedGlobals = collectShadowedWorkflowGlobals(root)
  walkNode(root, (node) => {
    const helper = readDirectWorkflowHelperCall(node, shadowedGlobals)
    if (!helper) {
      return
    }
    const args = readNodeArray(node, 'arguments')
    if (args.some((argument) => argument.type === 'SpreadElement')) {
      return
    }
    const contract = WORKFLOW_AUTHORING_HELPERS[helper]
    if (args.length < contract.minArgs || args.length > contract.maxArgs) {
      rejectHelper(
        node,
        helper,
        `expected ${contract.signature}, received ${args.length} argument${args.length === 1 ? '' : 's'}.`
      )
    }

    switch (helper) {
      case 'agent':
        assertPotentialString(args[0], node, helper, 'prompt')
        assertObjectWithProperties(args[1], node, helper, 'options', ['key'])
        break
      case 'parallel':
        assertPotentialString(args[0], node, helper, 'key')
        assertKeyedObjectArray(args[1], node, helper, 'tasks', ['key', 'run'])
        break
      case 'pipeline':
        assertPotentialString(args[0], node, helper, 'key')
        assertKeyedObjectArray(args[1], node, helper, 'items', ['key', 'value'])
        assertKeyedObjectArray(args[2], node, helper, 'stages', ['key', 'run'])
        break
      case 'mapLimit':
        assertPotentialString(args[0], node, helper, 'key')
        assertKeyedObjectArray(args[1], node, helper, 'items', ['key', 'value'])
        assertPositiveIntegerIfLiteral(args[2], node, helper, 'limit')
        assertFunctionIfLiteral(args[3], node, helper, 'mapper')
        break
      case 'phase':
        assertPotentialString(args[0], node, helper, 'key')
        if (args[1]) {
          assertObjectWithProperties(args[1], node, helper, 'options', [])
        }
        break
      case 'log':
        break
    }
  })
}

function readDirectWorkflowHelperCall(
  node: Node,
  shadowedGlobals: ReadonlySet<string>
): WorkflowAuthoringHelperName | null {
  if (node.type !== 'CallExpression') {
    return null
  }
  const callee = readNode(node, 'callee')
  if (!callee) {
    return null
  }
  if (callee.type === 'Identifier') {
    const name = readString(callee, 'name')
    return isWorkflowAuthoringHelperName(name) && !shadowedGlobals.has(name) ? name : null
  }
  if (callee.type !== 'MemberExpression' || shadowedGlobals.has('globalThis')) {
    return null
  }
  const object = readNode(callee, 'object')
  const propertyName = readStaticPropertyName(callee)
  return object?.type === 'Identifier' &&
    readString(object, 'name') === 'globalThis' &&
    isWorkflowAuthoringHelperName(propertyName)
    ? propertyName
    : null
}

function collectShadowedWorkflowGlobals(root: Node): Set<string> {
  const shadowed = new Set<string>()
  walkNode(root, (node) => {
    if (node.type === 'VariableDeclarator') {
      collectBindingNames(readNode(node, 'id'), shadowed)
      return
    }
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      collectBindingNames(readNode(node, 'id'), shadowed)
      for (const parameter of readNodeArray(node, 'params')) {
        collectBindingNames(parameter, shadowed)
      }
      return
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      collectBindingNames(readNode(node, 'id'), shadowed)
      return
    }
    if (node.type === 'CatchClause') {
      collectBindingNames(readNode(node, 'param'), shadowed)
    }
  })
  return shadowed
}

function collectBindingNames(node: Node | null, result: Set<string>): void {
  if (!node) {
    return
  }
  if (node.type === 'Identifier') {
    const name = readString(node, 'name')
    if (isWorkflowAuthoringHelperName(name) || name === 'globalThis') {
      result.add(name)
    }
    return
  }
  if (node.type === 'RestElement') {
    collectBindingNames(readNode(node, 'argument'), result)
    return
  }
  if (node.type === 'AssignmentPattern') {
    collectBindingNames(readNode(node, 'left'), result)
    return
  }
  if (node.type === 'ArrayPattern') {
    for (const element of readNodeArray(node, 'elements')) {
      collectBindingNames(element, result)
    }
    return
  }
  if (node.type === 'ObjectPattern') {
    for (const property of readNodeArray(node, 'properties')) {
      collectBindingNames(
        readNode(property, property.type === 'Property' ? 'value' : 'argument'),
        result
      )
    }
  }
}

function assertPotentialString(
  node: Node | undefined,
  call: Node,
  helper: WorkflowAuthoringHelperName,
  label: string
): void {
  if (!node) {
    return
  }
  if (node.type === 'Literal' && typeof readUnknown(node, 'value') !== 'string') {
    rejectHelper(call, helper, `${label} must be a string.`)
  }
  if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') {
    rejectHelper(call, helper, `${label} must be a string.`)
  }
}

function assertObjectWithProperties(
  node: Node | undefined,
  call: Node,
  helper: WorkflowAuthoringHelperName,
  label: string,
  requiredProperties: string[]
): void {
  if (!node) {
    return
  }
  if (node.type !== 'ObjectExpression') {
    if (node.type === 'Literal' || node.type === 'ArrayExpression') {
      rejectHelper(call, helper, `${label} must be an object.`)
    }
    return
  }
  for (const propertyName of requiredProperties) {
    if (!objectMayContainProperty(node, propertyName)) {
      rejectHelper(call, helper, `${label} must contain ${propertyName}.`)
    }
  }
}

function assertKeyedObjectArray(
  node: Node | undefined,
  call: Node,
  helper: WorkflowAuthoringHelperName,
  label: string,
  requiredProperties: string[]
): void {
  if (!node) {
    return
  }
  if (node.type !== 'ArrayExpression') {
    if (node.type === 'Literal' || node.type === 'ObjectExpression') {
      rejectHelper(call, helper, `${label} must be an array.`)
    }
    return
  }
  const elements = readUnknown(node, 'elements')
  if (!Array.isArray(elements)) {
    return
  }
  for (const element of elements) {
    if (!isNode(element) || element.type === 'SpreadElement') {
      continue
    }
    if (element.type !== 'ObjectExpression') {
      rejectHelper(call, helper, `${label} entries must be objects with ${requiredProperties.join(' and ')}.`)
    }
    for (const propertyName of requiredProperties) {
      if (!objectMayContainProperty(element, propertyName)) {
        rejectHelper(call, helper, `${label} entries must contain ${propertyName}.`)
      }
    }
  }
}

function objectMayContainProperty(node: Node, propertyName: string): boolean {
  for (const property of readNodeArray(node, 'properties')) {
    if (property.type === 'SpreadElement') {
      return true
    }
    if (property.type !== 'Property') {
      continue
    }
    if (readBoolean(property, 'computed') && readStaticPropertyName(property) === null) {
      return true
    }
    if (readStaticPropertyName(property) === propertyName) {
      return true
    }
  }
  return false
}

function assertPositiveIntegerIfLiteral(
  node: Node | undefined,
  call: Node,
  helper: WorkflowAuthoringHelperName,
  label: string
): void {
  if (node?.type !== 'Literal') {
    return
  }
  const value = readUnknown(node, 'value')
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    rejectHelper(call, helper, `${label} must be a positive integer.`)
  }
}

function assertFunctionIfLiteral(
  node: Node | undefined,
  call: Node,
  helper: WorkflowAuthoringHelperName,
  label: string
): void {
  if (!node) {
    return
  }
  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'Identifier' ||
    node.type === 'MemberExpression'
  ) {
    return
  }
  if (node.type === 'Literal' || node.type === 'ObjectExpression' || node.type === 'ArrayExpression') {
    rejectHelper(call, helper, `${label} must be a function.`)
  }
}

function rejectHelper(
  node: Node,
  helper: WorkflowAuthoringHelperName,
  detail: string
): never {
  const location = readSourceLocation(node)
  const prefix = location ? `Workflow helper "${helper}" at ${location.line}:${location.column}` : `Workflow helper "${helper}"`
  throw new WorkflowSourceValidationError(
    `${prefix} is invalid: ${detail} Expected ${WORKFLOW_AUTHORING_HELPERS[helper].signature}`,
    'INVALID_HELPER_CALL',
    helper,
    location?.line ?? null,
    location?.column ?? null
  )
}

function readSourceLocation(node: Node): { line: number; column: number } | null {
  const loc = readUnknown(node, 'loc')
  if (!loc || typeof loc !== 'object') {
    return null
  }
  const start = (loc as { start?: unknown }).start
  if (!start || typeof start !== 'object') {
    return null
  }
  const line = (start as { line?: unknown }).line
  const column = (start as { column?: unknown }).column
  return typeof line === 'number' && typeof column === 'number'
    ? { line: Math.max(1, line - 1), column }
    : null
}

function walkNode(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    visit(node)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue
      }
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (isNode(value[index])) {
            stack.push(value[index])
          }
        }
      } else if (isNode(value)) {
        stack.push(value)
      }
    }
  }
}

function assertMutationTargetAllowed(target: Node | null): void {
  if (!target) {
    return
  }
  if (target.type === 'RestElement') {
    assertMutationTargetAllowed(readNode(target, 'argument'))
    return
  }
  if (target.type === 'AssignmentPattern') {
    assertMutationTargetAllowed(readNode(target, 'left'))
    return
  }
  if (target.type === 'ArrayPattern') {
    for (const element of readNodeArray(target, 'elements')) {
      assertMutationTargetAllowed(element)
    }
    return
  }
  if (target.type === 'ObjectPattern') {
    for (const property of readNodeArray(target, 'properties')) {
      assertMutationTargetAllowed(
        readNode(property, property.type === 'Property' ? 'value' : 'argument')
      )
    }
    return
  }
  const targetName = target.type === 'Identifier' ? readString(target, 'name') : null
  if (targetName && INJECTED_GLOBALS.has(targetName)) {
    reject(`Mutation of injected global "${targetName}" is unavailable.`)
  }
  if (target.type !== 'MemberExpression') {
    return
  }
  const root = readMemberRoot(target)
  if (root && (INJECTED_GLOBALS.has(root) || root === 'globalThis')) {
    reject(`Mutation through injected global "${root}" is unavailable.`)
  }
}

function readMemberRoot(node: Node): string | null {
  let current: Node | null = node
  while (current?.type === 'MemberExpression') {
    current = readNode(current, 'object')
  }
  return current?.type === 'Identifier' ? readString(current, 'name') : null
}

function readStaticPropertyName(node: Node): string | null {
  if (node.type !== 'MemberExpression' && node.type !== 'Property') {
    return null
  }
  const property = readNode(node, node.type === 'Property' ? 'key' : 'property')
  if (!property) {
    return null
  }
  const computed = readBoolean(node, 'computed')
  if (!computed && property.type === 'Identifier') {
    return readString(property, 'name')
  }
  if (property.type === 'Literal' && typeof readUnknown(property, 'value') === 'string') {
    return readString(property, 'value')
  }
  return null
}

function readIdentifier(node: Node, key: string): string | null {
  const value = readNode(node, key)
  return value?.type === 'Identifier' ? readString(value, 'name') : null
}

function readNode(node: Node, key: string): Node | null {
  const value = readUnknown(node, key)
  return isNode(value) ? value : null
}

function readNodeArray(node: Node, key: string): Node[] {
  const value = readUnknown(node, key)
  return Array.isArray(value) ? value.filter(isNode) : []
}

function readString(node: Node, key: string): string | null {
  const value = readUnknown(node, key)
  return typeof value === 'string' ? value : null
}

function readBoolean(node: Node, key: string): boolean {
  return readUnknown(node, key) === true
}

function readUnknown(node: Node, key: string): unknown {
  return (node as unknown as Record<string, unknown>)[key]
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function normalizeStrictModeLocation(message: string): string {
  return message.replace(/\((\d+):(\d+)\)$/u, (_match, line: string, column: string) => {
    return `(${Math.max(1, Number(line) - 1)}:${column})`
  })
}

function reject(message: string): never {
  throw new WorkflowSourceValidationError(message)
}
