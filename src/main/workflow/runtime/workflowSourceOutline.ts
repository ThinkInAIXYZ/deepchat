import type { Node } from 'acorn'
import {
  WORKFLOW_SOURCE_OUTLINE_MAX_NODES,
  WORKFLOW_SOURCE_OUTLINE_SCHEMA_VERSION,
  WorkflowSourceOutlineSchema,
  type WorkflowSourceOutline,
  type WorkflowSourceOutlineNode,
  type WorkflowSourceOutlineNodeKind
} from '@shared/workflow/outline'
import { validateWorkflowSource } from './workflowSourceValidator'

type WorkflowHelperName = 'phase' | 'agent' | 'parallel' | 'pipeline' | 'mapLimit'

const HELPER_NAMES = new Set<WorkflowHelperName>([
  'phase',
  'agent',
  'parallel',
  'pipeline',
  'mapLimit'
])

const HELPER_KINDS: Record<WorkflowHelperName, WorkflowSourceOutlineNodeKind> = {
  phase: 'phase',
  agent: 'agent',
  parallel: 'parallel',
  pipeline: 'pipeline',
  mapLimit: 'map_limit'
}

interface OutlineCandidate {
  helper: WorkflowHelperName
  node: Node
  start: number
}

export function deriveWorkflowSourceOutline(source: string): WorkflowSourceOutline {
  return deriveWorkflowSourceOutlineFromAst(validateWorkflowSource(source))
}

export function deriveWorkflowSourceOutlineFromAst(root: Node): WorkflowSourceOutline {
  const shadowedGlobals = collectShadowedGlobals(root)
  const candidates: OutlineCandidate[] = []
  let partial = shadowedGlobals.size > 0

  walkAst(root, (node, parent) => {
    const helper = readDirectHelperCall(node, shadowedGlobals)
    if (helper) {
      candidates.push({
        helper,
        node,
        start: readNumber(node, 'start') ?? Number.MAX_SAFE_INTEGER
      })
    }
    if (isPotentialDynamicHelperReference(node, parent, shadowedGlobals)) {
      partial = true
    }
  })

  candidates.sort((left, right) => left.start - right.start)
  const truncated = candidates.length > WORKFLOW_SOURCE_OUTLINE_MAX_NODES
  const visibleCandidates = candidates.slice(0, WORKFLOW_SOURCE_OUTLINE_MAX_NODES)
  const nodes = visibleCandidates.map((candidate, index) => {
    const node = projectCandidate(candidate, index + 1)
    partial ||= node.dynamic
    return node
  })

  return WorkflowSourceOutlineSchema.parse({
    schemaVersion: WORKFLOW_SOURCE_OUTLINE_SCHEMA_VERSION,
    confidence: partial || truncated ? 'partial' : 'exact',
    truncated,
    nodes
  })
}

export function createPartialWorkflowSourceOutline(): WorkflowSourceOutline {
  return {
    schemaVersion: WORKFLOW_SOURCE_OUTLINE_SCHEMA_VERSION,
    confidence: 'partial',
    truncated: false,
    nodes: []
  }
}

function projectCandidate(
  candidate: OutlineCandidate,
  ordinal: number
): WorkflowSourceOutlineNode {
  const args = readNodeArray(candidate.node, 'arguments')
  const options = args[1]
  const key =
    candidate.helper === 'agent'
      ? readObjectStringProperty(options, 'key', 256)
      : readStringLiteral(args[0], 256)
  const label =
    candidate.helper === 'agent' || candidate.helper === 'phase'
      ? readObjectStringProperty(options, 'label', 512)
      : { present: false, reliable: true, value: null }
  let itemCount: number | null = null
  let stageCount: number | null = null
  let concurrency: number | null = null
  let collectionKeysStatic = true

  if (candidate.helper === 'parallel') {
    itemCount = readArrayLength(args[1])
    collectionKeysStatic = hasStaticObjectKeys(args[1])
  } else if (candidate.helper === 'pipeline') {
    itemCount = readArrayLength(args[1])
    stageCount = readArrayLength(args[2])
    collectionKeysStatic = hasStaticObjectKeys(args[1]) && hasStaticObjectKeys(args[2])
  } else if (candidate.helper === 'mapLimit') {
    itemCount = readArrayLength(args[1])
    concurrency = readPositiveIntegerLiteral(args[2])
    collectionKeysStatic = hasStaticObjectKeys(args[1])
  }

  const keyDynamic = key.value === null
  const labelDynamic = !label.reliable
  const collectionDynamic =
    (candidate.helper === 'parallel' ||
      candidate.helper === 'pipeline' ||
      candidate.helper === 'mapLimit') &&
    (itemCount === null || !collectionKeysStatic)
  const pipelineDynamic = candidate.helper === 'pipeline' && stageCount === null
  const concurrencyDynamic = candidate.helper === 'mapLimit' && concurrency === null

  return {
    id: `outline-${ordinal}`,
    ordinal,
    kind: HELPER_KINDS[candidate.helper],
    key: key.value,
    label: label.value,
    itemCount,
    stageCount,
    concurrency,
    dynamic:
      keyDynamic ||
      !key.reliable ||
      labelDynamic ||
      collectionDynamic ||
      pipelineDynamic ||
      concurrencyDynamic
  }
}

function readDirectHelperCall(
  node: Node,
  shadowedGlobals: ReadonlySet<string>
): WorkflowHelperName | null {
  if (node.type !== 'CallExpression') {
    return null
  }
  const callee = readNode(node, 'callee')
  if (!callee) {
    return null
  }
  if (callee.type === 'Identifier') {
    const name = readString(callee, 'name')
    return isHelperName(name) && !shadowedGlobals.has(name) ? name : null
  }
  if (callee.type !== 'MemberExpression' || shadowedGlobals.has('globalThis')) {
    return null
  }
  const object = readNode(callee, 'object')
  const propertyName = readStaticPropertyName(callee)
  return object?.type === 'Identifier' &&
    readString(object, 'name') === 'globalThis' &&
    isHelperName(propertyName)
    ? propertyName
    : null
}

function isPotentialDynamicHelperReference(
  node: Node,
  parent: Node | null,
  shadowedGlobals: ReadonlySet<string>
): boolean {
  if (node.type === 'MemberExpression') {
    const propertyName = readStaticPropertyName(node)
    if (
      propertyName === null &&
      readBoolean(node, 'computed') &&
      parent?.type === 'CallExpression' &&
      readNode(parent, 'callee') === node
    ) {
      return true
    }
    if (!isHelperName(propertyName)) {
      return false
    }
    const isDirectCall =
      parent?.type === 'CallExpression' &&
      readNode(parent, 'callee') === node &&
      readDirectHelperCall(parent, shadowedGlobals) === propertyName
    return !isDirectCall
  }
  if (node.type !== 'Identifier') {
    return false
  }
  const name = readString(node, 'name')
  if (name === 'globalThis') {
    return !(
      parent?.type === 'MemberExpression' &&
      readNode(parent, 'object') === node &&
      isHelperName(readStaticPropertyName(parent))
    )
  }
  if (!isHelperName(name)) {
    return false
  }
  if (
    parent?.type === 'MemberExpression' &&
    readNode(parent, 'property') === node &&
    !readBoolean(parent, 'computed')
  ) {
    return false
  }
  return !(
    parent?.type === 'CallExpression' &&
    readNode(parent, 'callee') === node &&
    readDirectHelperCall(parent, shadowedGlobals) === name
  )
}

function collectShadowedGlobals(root: Node): Set<string> {
  const shadowed = new Set<string>()
  walkAst(root, (node) => {
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
    if ((name && isHelperName(name)) || name === 'globalThis') {
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
      if (property.type === 'Property') {
        collectBindingNames(readNode(property, 'value'), result)
      } else if (property.type === 'RestElement') {
        collectBindingNames(readNode(property, 'argument'), result)
      }
    }
  }
}

function readObjectStringProperty(
  node: Node | undefined,
  propertyName: string,
  maxLength: number
): {
  present: boolean
  reliable: boolean
  value: string | null
} {
  if (!node) {
    return { present: false, reliable: true, value: null }
  }
  if (node.type !== 'ObjectExpression') {
    return { present: false, reliable: false, value: null }
  }
  let present = false
  let reliable = true
  let value: string | null = null
  for (const property of readNodeArray(node, 'properties')) {
    if (property.type === 'SpreadElement') {
      reliable = false
      continue
    }
    if (
      property.type === 'Property' &&
      readBoolean(property, 'computed') &&
      readStaticPropertyName(property) === null
    ) {
      reliable = false
      continue
    }
    if (property.type !== 'Property' || readStaticPropertyName(property) !== propertyName) {
      continue
    }
    present = true
    const literal = readStringLiteral(readNode(property, 'value'), maxLength)
    reliable &&= literal.reliable
    value = literal.value
  }
  return {
    present,
    reliable,
    value: reliable ? value : null
  }
}

function hasStaticObjectKeys(node: Node | undefined): boolean {
  if (!node || node.type !== 'ArrayExpression') {
    return false
  }
  const elements = readUnknown(node, 'elements')
  if (!Array.isArray(elements)) {
    return false
  }
  return elements.every((element) => {
    if (!isNode(element) || element.type !== 'ObjectExpression') {
      return false
    }
    const key = readObjectStringProperty(element, 'key', 256)
    return key.present && key.reliable && key.value !== null
  })
}

function readArrayLength(node: Node | undefined): number | null {
  if (!node || node.type !== 'ArrayExpression') {
    return null
  }
  const elements = readUnknown(node, 'elements')
  return Array.isArray(elements) &&
    elements.length <= 1_000_000 &&
    elements.every((element) => !isNode(element) || element.type !== 'SpreadElement')
    ? elements.length
    : null
}

function readPositiveIntegerLiteral(node: Node | undefined): number | null {
  if (!node || node.type !== 'Literal') {
    return null
  }
  const value = readUnknown(node, 'value')
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 1_000_000
    ? value
    : null
}

function readStringLiteral(
  node: Node | undefined | null,
  maxLength: number
): {
  present: boolean
  reliable: boolean
  value: string | null
} {
  if (!node) {
    return { present: false, reliable: false, value: null }
  }
  if (node.type === 'Literal') {
    const value = readUnknown(node, 'value')
    return {
      present: true,
      reliable: typeof value === 'string' && value.length > 0 && value.length <= maxLength,
      value:
        typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
    }
  }
  if (node.type === 'TemplateLiteral') {
    const expressions = readNodeArray(node, 'expressions')
    const quasis = readUnknown(node, 'quasis')
    const quasiValue =
      Array.isArray(quasis) && quasis.length === 1 && isNode(quasis[0])
        ? readUnknown(quasis[0], 'value')
        : null
    const cooked =
      typeof quasiValue === 'object' && quasiValue !== null
        ? (quasiValue as { cooked?: unknown }).cooked
        : null
    return {
      present: true,
      reliable:
        expressions.length === 0 &&
        typeof cooked === 'string' &&
        cooked.length > 0 &&
        cooked.length <= maxLength,
      value:
        expressions.length === 0 &&
        typeof cooked === 'string' &&
        cooked.length > 0 &&
        cooked.length <= maxLength
          ? cooked
          : null
    }
  }
  return { present: true, reliable: false, value: null }
}

function walkAst(root: Node, visit: (node: Node, parent: Node | null) => void): void {
  const stack: Array<{ node: Node; parent: Node | null }> = [{ node: root, parent: null }]
  while (stack.length > 0) {
    const current = stack.pop()!
    visit(current.node, current.parent)
    const children = collectChildNodes(current.node)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], parent: current.node })
    }
  }
}

function collectChildNodes(node: Node): Node[] {
  const children: Node[] = []
  const seen = new Set<Node>()
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item) && !seen.has(item)) {
          seen.add(item)
          children.push(item)
        }
      }
    } else if (isNode(value) && !seen.has(value)) {
      seen.add(value)
      children.push(value)
    }
  }
  return children.sort(
    (left, right) =>
      (readNumber(left, 'start') ?? Number.MAX_SAFE_INTEGER) -
      (readNumber(right, 'start') ?? Number.MAX_SAFE_INTEGER)
  )
}

function readStaticPropertyName(node: Node): string | null {
  if (node.type !== 'MemberExpression' && node.type !== 'Property') {
    return null
  }
  const property = readNode(node, node.type === 'Property' ? 'key' : 'property')
  if (!property) {
    return null
  }
  if (!readBoolean(node, 'computed') && property.type === 'Identifier') {
    return readString(property, 'name')
  }
  if (property.type === 'Literal') {
    const value = readUnknown(property, 'value')
    return typeof value === 'string' ? value : null
  }
  return null
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

function readNumber(node: Node, key: string): number | null {
  const value = readUnknown(node, key)
  return typeof value === 'number' ? value : null
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

function isHelperName(value: string | null): value is WorkflowHelperName {
  return value !== null && HELPER_NAMES.has(value as WorkflowHelperName)
}
