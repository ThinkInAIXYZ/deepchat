import { parse, type Node } from 'acorn'

const INJECTED_GLOBALS = new Set([
  'agent',
  'parallel',
  'pipeline',
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
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowSourceValidationError'
  }
}

export function validateWorkflowSource(source: string): void {
  let root: Node
  try {
    root = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true
    })
  } catch (error) {
    throw new WorkflowSourceValidationError(
      error instanceof Error ? error.message : 'Workflow source is not valid JavaScript.'
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
    if (node.type === 'UpdateExpression' || node.type === 'UnaryExpression') {
      if (node.type === 'UnaryExpression' && readString(node, 'operator') !== 'delete') {
        return
      }
      assertMutationTargetAllowed(readNode(node, 'argument'))
    }
  })
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
  if (node.type !== 'MemberExpression') {
    return null
  }
  const property = readNode(node, 'property')
  if (!property) {
    return null
  }
  const computed = readBoolean(node, 'computed')
  if (!computed && property.type === 'Identifier') {
    return readString(property, 'name')
  }
  if (
    computed &&
    property.type === 'Literal' &&
    typeof readUnknown(property, 'value') === 'string'
  ) {
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

function reject(message: string): never {
  throw new WorkflowSourceValidationError(message)
}
