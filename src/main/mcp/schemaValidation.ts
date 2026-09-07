import type { Tool } from '@shared/types/mcp'

const MAX_SCHEMA_BYTES = 1024 * 1024
const MAX_METADATA_BYTES = 256 * 1024
const MAX_JSON_DEPTH = 64
const MAX_JSON_KEYS = 10_000
const MAX_JSON_NODES = 100_000
const MAX_COMPOSITION_BRANCHES = 256

const SUPPORTED_JSON_SCHEMA_DIALECTS = new Set([
  'https://json-schema.org/draft/2020-12/schema',
  'https://json-schema.org/draft/2020-12/schema#',
  'http://json-schema.org/draft-07/schema',
  'http://json-schema.org/draft-07/schema#',
  'https://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema#'
])

interface CloneLimits {
  maxBytes: number
  independentArrayItemsAtPath?: string
}

interface CloneState {
  keys: number
  nodes: number
}

export type JsonValueDifference = {
  readonly path: string
  readonly kind: 'type' | 'value' | 'array-length' | 'missing-key' | 'unexpected-key'
}

const jsonValueKind = (value: unknown): string => {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

const appendJsonPointerSegment = (path: string, segment: string): string =>
  `${path}/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`

/**
 * Compares values that already crossed the bounded MCP JSON validation boundary. JSON object
 * prototypes and insertion order are intentionally ignored because neither is protocol data.
 */
export function findJsonValueDifference(
  expected: unknown,
  actual: unknown,
  path = '#'
): JsonValueDifference | null {
  if (expected === actual) {
    return null
  }

  const expectedKind = jsonValueKind(expected)
  const actualKind = jsonValueKind(actual)
  if (expectedKind !== actualKind) {
    return { path, kind: 'type' }
  }

  if (expectedKind === 'array') {
    const expectedItems = expected as unknown[]
    const actualItems = actual as unknown[]
    const sharedLength = Math.min(expectedItems.length, actualItems.length)
    for (let index = 0; index < sharedLength; index += 1) {
      const difference = findJsonValueDifference(
        expectedItems[index],
        actualItems[index],
        appendJsonPointerSegment(path, String(index))
      )
      if (difference) {
        return difference
      }
    }
    return expectedItems.length === actualItems.length ? null : { path, kind: 'array-length' }
  }

  if (expectedKind === 'object') {
    const expectedRecord = expected as Record<string, unknown>
    const actualRecord = actual as Record<string, unknown>
    const keys = Array.from(
      new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])
    ).sort()

    for (const key of keys) {
      const differencePath = appendJsonPointerSegment(path, key)
      if (!Object.hasOwn(expectedRecord, key)) {
        return { path: differencePath, kind: 'unexpected-key' }
      }
      if (!Object.hasOwn(actualRecord, key)) {
        return { path: differencePath, kind: 'missing-key' }
      }
      const difference = findJsonValueDifference(
        expectedRecord[key],
        actualRecord[key],
        differencePath
      )
      if (difference) {
        return difference
      }
    }
    return null
  }

  return { path, kind: 'value' }
}

function cloneBoundedJson(value: unknown, label: string, limits: CloneLimits): unknown {
  const state: CloneState = {
    keys: 0,
    nodes: 0
  }
  const seen = new WeakSet<object>()

  const visit = (
    current: unknown,
    depth: number,
    path: string,
    complexity: CloneState
  ): unknown => {
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`${label} exceeds the maximum JSON depth`)
    }

    complexity.nodes += 1
    if (complexity.nodes > MAX_JSON_NODES) {
      throw new Error(`${label} exceeds the maximum JSON node count`)
    }

    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      return current
    }

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new Error(`${label} contains a non-finite number at ${path}`)
      }
      return current
    }

    if (Array.isArray(current)) {
      if (seen.has(current)) {
        throw new Error(`${label} contains a circular reference at ${path}`)
      }
      seen.add(current)
      const independentItems = path === limits.independentArrayItemsAtPath
      const cloned = current.map((entry, index) =>
        entry === undefined
          ? null
          : visit(
              entry,
              depth + 1,
              `${path}/${index}`,
              independentItems ? { keys: 0, nodes: 0 } : complexity
            )
      )
      seen.delete(current)
      return cloned
    }

    if (typeof current !== 'object') {
      throw new Error(`${label} contains a non-JSON value at ${path}`)
    }

    if (seen.has(current)) {
      throw new Error(`${label} contains a circular reference at ${path}`)
    }
    seen.add(current)

    const entries = Object.entries(current).filter(([, entry]) => entry !== undefined)
    complexity.keys += entries.length
    if (complexity.keys > MAX_JSON_KEYS) {
      throw new Error(`${label} exceeds the maximum JSON key count`)
    }

    const cloned: Record<string, unknown> = Object.create(null)
    for (const [key, entry] of entries) {
      cloned[key] = visit(entry, depth + 1, `${path}/${key}`, complexity)
    }

    seen.delete(current)
    return cloned
  }

  const cloned = visit(value, 0, '#', state)
  const serialized = JSON.stringify(cloned)
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxBytes) {
    throw new Error(`${label} exceeds the maximum serialized size`)
  }
  return cloned
}

function validateSchemaTree(schema: Record<string, unknown>, label: string): void {
  let compositionBranches = 0
  const schemaMaps = new Set([
    '$defs',
    'definitions',
    'properties',
    'patternProperties',
    'dependentSchemas'
  ])
  const singleSchemas = new Set([
    'additionalItems',
    'additionalProperties',
    'contains',
    'contentSchema',
    'else',
    'if',
    'items',
    'not',
    'propertyNames',
    'then',
    'unevaluatedItems',
    'unevaluatedProperties'
  ])
  const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

  const visit = (node: unknown, path: string): void => {
    if (typeof node === 'boolean') {
      return
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`${label} contains an invalid schema node at ${path}`)
    }
    const record = node as Record<string, unknown>
    for (const reference of ['$ref', '$dynamicRef'] as const) {
      const value = record[reference]
      if (value === undefined) {
        continue
      }
      if (typeof value !== 'string') {
        throw new Error(`${label} contains a non-string ${reference} at ${path}`)
      }
      if (!value.startsWith('#')) {
        throw new Error(`${label} contains a remote ${reference} at ${path}`)
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (schemaArrays.has(key)) {
        if (!Array.isArray(value)) {
          throw new Error(`${label} contains a non-array ${key} at ${path}`)
        }
        if (key !== 'prefixItems') {
          compositionBranches += value.length
          if (compositionBranches > MAX_COMPOSITION_BRANCHES) {
            throw new Error(`${label} exceeds the maximum schema composition size`)
          }
        }
        value.forEach((entry, index) => visit(entry, `${path}/${key}/${index}`))
      } else if (schemaMaps.has(key)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`${label} contains an invalid ${key} map at ${path}`)
        }
        for (const [name, entry] of Object.entries(value)) {
          visit(entry, `${path}/${key}/${name}`)
        }
      } else if (key === 'dependencies') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`${label} contains an invalid dependencies map at ${path}`)
        }
        for (const [name, entry] of Object.entries(value)) {
          if (!Array.isArray(entry)) {
            visit(entry, `${path}/${key}/${name}`)
          }
        }
      } else if (singleSchemas.has(key)) {
        if (key === 'items' && Array.isArray(value)) {
          value.forEach((entry, index) => visit(entry, `${path}/${key}/${index}`))
        } else {
          visit(value, `${path}/${key}`)
        }
      }
    }
  }

  visit(schema, '#')
}

export function assertBoundedMcpJson(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { independentArrayItemsAtPath?: string } = {}
): void {
  cloneBoundedJson(value, label, {
    maxBytes,
    ...options
  })
}

function cloneJsonSchema(
  value: unknown,
  label: string,
  validateSemantics: boolean
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }

  const cloned = cloneBoundedJson(value, label, {
    maxBytes: MAX_SCHEMA_BYTES
  }) as Record<string, unknown>
  if (validateSemantics) {
    const dialect = cloned.$schema
    if (dialect !== undefined) {
      if (typeof dialect !== 'string' || !SUPPORTED_JSON_SCHEMA_DIALECTS.has(dialect)) {
        throw new Error(`${label} uses an unsupported JSON Schema dialect`)
      }
    }
    validateSchemaTree(cloned, label)
  }
  return cloned
}

export function validateAndCloneJsonSchema(value: unknown, label: string): Record<string, unknown> {
  return cloneJsonSchema(value, label, true)
}

function cloneMetadata(
  value: Record<string, unknown> | undefined,
  label: string
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }
  return cloneBoundedJson(value, label, {
    maxBytes: MAX_METADATA_BYTES
  }) as Record<string, unknown>
}

export function validateAndCloneMcpTool(
  tool: Tool,
  serverName: string,
  schemaPolicy: 'strict' | 'legacy' = 'strict'
): Tool {
  const label = `MCP tool ${serverName}/${tool.name}`
  const validateSchemaSemantics = schemaPolicy === 'strict'
  let outputSchema: Record<string, unknown> | undefined
  if (tool.outputSchema !== undefined) {
    try {
      outputSchema = cloneJsonSchema(
        tool.outputSchema,
        `${label} outputSchema`,
        validateSchemaSemantics
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`Ignoring invalid ${label} outputSchema: ${reason}`)
    }
  }

  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    icons: tool.icons
      ? (cloneBoundedJson(tool.icons, `${label} icons`, {
          maxBytes: MAX_METADATA_BYTES
        }) as Tool['icons'])
      : undefined,
    inputSchema: cloneJsonSchema(tool.inputSchema, `${label} inputSchema`, validateSchemaSemantics),
    outputSchema,
    annotations: cloneMetadata(tool.annotations, `${label} annotations`),
    _meta: cloneMetadata(tool._meta, `${label} metadata`),
    execution: cloneMetadata(tool.execution, `${label} execution`)
  }
}
