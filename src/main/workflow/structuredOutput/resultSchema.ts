import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import type { JsonValue } from '@shared/contracts/common'
import { canonicalizeWorkflowJson, WorkflowJsonError } from '@/workflow/domain/json'
import { WorkflowStructuredOutputError } from './errors'

const MAX_SCHEMA_BYTES = 24 * 1024
const MAX_SCHEMA_DEPTH = 12
const MAX_SCHEMA_NODES = 256
const MAX_SCHEMA_COLLECTION_ENTRIES = 2_048
const MAX_OBJECT_PROPERTIES = 128
const MAX_ARRAY_ITEMS = 1_024
const MAX_COMBINATOR_BRANCHES = 8
const MAX_ENUM_VALUES = 128
const MAX_TITLE_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 1_024
const MAX_VALIDATION_ERRORS = 8
const MAX_VALIDATION_MESSAGE_LENGTH = 2_048

const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const JSON_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string'
])
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minProperties',
  'maxProperties',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'not'
])

export interface PreparedWorkflowResultSchema {
  readonly schema: JsonValue
  readonly schemaJson: string
  readonly maxResultBytes: number
  validate(value: unknown): JsonValue
  parseExactJson(value: string): JsonValue
}

export function prepareWorkflowResultSchema(
  schema: JsonValue,
  maxResultBytes: number
): PreparedWorkflowResultSchema {
  if (!Number.isInteger(maxResultBytes) || maxResultBytes < 1 || maxResultBytes > 8 * 1024 * 1024) {
    throw schemaError('Workflow structured-output result limit must be 1-8388608 bytes.')
  }

  let canonicalInput: JsonValue
  try {
    canonicalInput = canonicalizeWorkflowJson(schema, {
      maxBytes: MAX_SCHEMA_BYTES,
      maxDepth: MAX_SCHEMA_DEPTH,
      maxCollectionEntries: MAX_SCHEMA_COLLECTION_ENTRIES
    }).value
  } catch (error) {
    throw schemaError(toBoundedErrorMessage(error), error)
  }
  if (!isJsonObject(canonicalInput)) {
    throw schemaError('Workflow structured-output schema must be a JSON Schema object.')
  }

  const state = { nodes: 0, maxResultBytes }
  const normalized = normalizeSchemaNode(canonicalInput, '$', 0, state)
  if (normalized.type !== 'object') {
    throw schemaError('Workflow structured-output root schema must have type "object".')
  }
  const canonicalSchema = canonicalizeWorkflowJson(normalized, {
    maxBytes: MAX_SCHEMA_BYTES,
    maxDepth: MAX_SCHEMA_DEPTH,
    maxCollectionEntries: MAX_SCHEMA_COLLECTION_ENTRIES
  })

  let validator: ValidateFunction
  try {
    const ajv = new Ajv({
      allErrors: true,
      strict: true,
      validateFormats: false,
      ownProperties: true
    })
    validator = ajv.compile(canonicalSchema.value as object)
  } catch (error) {
    throw schemaError(
      `Workflow structured-output schema cannot be compiled: ${toBoundedErrorMessage(error)}`,
      error
    )
  }

  const validate = (value: unknown): JsonValue => {
    let canonicalResult: JsonValue
    try {
      canonicalResult = canonicalizeWorkflowJson(value, {
        maxBytes: maxResultBytes,
        maxDepth: 32,
        maxCollectionEntries: 10_000
      }).value
    } catch (error) {
      throw resultError(toBoundedErrorMessage(error), error)
    }
    if (!validator(canonicalResult)) {
      throw resultError(formatValidationErrors(validator.errors))
    }
    return canonicalResult
  }

  return Object.freeze({
    schema: canonicalSchema.value,
    schemaJson: canonicalSchema.json,
    maxResultBytes,
    validate,
    parseExactJson: (value: string) => {
      const normalized = value.trim()
      if (!normalized) {
        throw resultError('Structured result is empty.')
      }
      if (Buffer.byteLength(normalized, 'utf8') > maxResultBytes) {
        throw resultError(`Structured result exceeds the ${maxResultBytes}-byte limit.`)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(normalized)
      } catch (error) {
        throw resultError(
          'Structured result must be one exact JSON value without prose or fences.',
          error
        )
      }
      return validate(parsed)
    }
  })
}

function normalizeSchemaNode(
  schema: Record<string, JsonValue>,
  path: string,
  depth: number,
  state: { nodes: number; maxResultBytes: number }
): Record<string, JsonValue> {
  state.nodes += 1
  if (state.nodes > MAX_SCHEMA_NODES) {
    throw schemaError(`Workflow structured-output schema exceeds ${MAX_SCHEMA_NODES} nodes.`)
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    throw schemaError(
      `Workflow structured-output schema exceeds depth ${MAX_SCHEMA_DEPTH} at ${path}.`
    )
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw schemaError(`Unsupported JSON Schema keyword "${key}" at ${path}.`)
    }
  }

  const output: Record<string, JsonValue> = Object.create(null)
  const types = normalizeTypes(schema.type, path)
  if (schema.type !== undefined) {
    output.type = schema.type
  }
  copyBoundedText(schema, output, 'title', MAX_TITLE_LENGTH, path)
  copyBoundedText(schema, output, 'description', MAX_DESCRIPTION_LENGTH, path)
  copyNumberKeyword(schema, output, 'minimum', path)
  copyNumberKeyword(schema, output, 'maximum', path)
  copyNumberKeyword(schema, output, 'exclusiveMinimum', path)
  copyNumberKeyword(schema, output, 'exclusiveMaximum', path)
  copyPositiveNumberKeyword(schema, output, 'multipleOf', path)

  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length < 1 ||
      schema.enum.length > MAX_ENUM_VALUES
    ) {
      throw schemaError(`"enum" at ${path} must contain 1-${MAX_ENUM_VALUES} values.`)
    }
    output.enum = schema.enum
  }
  if (schema.const !== undefined) {
    output.const = schema.const
  }

  normalizeCombinator(schema, output, 'anyOf', path, depth, state)
  normalizeCombinator(schema, output, 'oneOf', path, depth, state)
  normalizeCombinator(schema, output, 'allOf', path, depth, state)
  if (schema.not !== undefined) {
    if (!isJsonObject(schema.not)) {
      throw schemaError(`"not" at ${path} must be a schema object.`)
    }
    output.not = normalizeSchemaNode(schema.not, `${path}.not`, depth + 1, state)
  }

  const hasObjectType = types.has('object')
  if (hasObjectType) {
    const properties = schema.properties ?? Object.create(null)
    if (!isJsonObject(properties)) {
      throw schemaError(`"properties" at ${path} must be an object.`)
    }
    const propertyEntries = Object.entries(properties)
    if (propertyEntries.length > MAX_OBJECT_PROPERTIES) {
      throw schemaError(`Object schema at ${path} exceeds ${MAX_OBJECT_PROPERTIES} properties.`)
    }
    const normalizedProperties: Record<string, JsonValue> = Object.create(null)
    for (const [name, propertySchema] of propertyEntries) {
      if (
        !name ||
        name.length > 128 ||
        UNSAFE_PROPERTY_NAMES.has(name) ||
        hasAsciiControlCharacter(name)
      ) {
        throw schemaError(`Unsafe schema property "${name}" at ${path}.`)
      }
      if (!isJsonObject(propertySchema)) {
        throw schemaError(`Property schema ${path}.properties.${name} must be an object.`)
      }
      normalizedProperties[name] = normalizeSchemaNode(
        propertySchema,
        `${path}.properties.${name}`,
        depth + 1,
        state
      )
    }
    output.properties = normalizedProperties

    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required)) {
        throw schemaError(`"required" at ${path} must be an array.`)
      }
      const required = schema.required.map((name) => {
        if (typeof name !== 'string' || !name || !Object.hasOwn(normalizedProperties, name)) {
          throw schemaError(`"required" at ${path} must reference declared properties.`)
        }
        return name
      })
      if (required.length > MAX_OBJECT_PROPERTIES || new Set(required).size !== required.length) {
        throw schemaError(`"required" at ${path} contains too many or duplicate properties.`)
      }
      output.required = required
    }
    if (schema.additionalProperties !== false) {
      throw schemaError(`"additionalProperties" at ${path} must be false.`)
    }
    output.additionalProperties = false
    output.minProperties = normalizeBoundedInteger(
      schema.minProperties,
      0,
      MAX_OBJECT_PROPERTIES,
      'minProperties',
      path
    )
    output.maxProperties =
      schema.maxProperties === undefined
        ? MAX_OBJECT_PROPERTIES
        : normalizeBoundedInteger(
            schema.maxProperties,
            0,
            MAX_OBJECT_PROPERTIES,
            'maxProperties',
            path
          )
    assertOrderedBounds(output.minProperties, output.maxProperties, 'properties', path)
  } else {
    rejectKeywords(
      schema,
      ['properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties'],
      path
    )
  }

  const hasArrayType = types.has('array')
  if (hasArrayType) {
    if (!isJsonObject(schema.items)) {
      throw schemaError(`Array schema at ${path} requires one object-valued "items" schema.`)
    }
    output.items = normalizeSchemaNode(schema.items, `${path}.items`, depth + 1, state)
    output.minItems = normalizeBoundedInteger(schema.minItems, 0, MAX_ARRAY_ITEMS, 'minItems', path)
    output.maxItems =
      schema.maxItems === undefined
        ? MAX_ARRAY_ITEMS
        : normalizeBoundedInteger(schema.maxItems, 0, MAX_ARRAY_ITEMS, 'maxItems', path)
    assertOrderedBounds(output.minItems, output.maxItems, 'items', path)
  } else {
    rejectKeywords(schema, ['items', 'minItems', 'maxItems'], path)
  }

  const hasStringType = types.has('string')
  if (hasStringType) {
    output.minLength = normalizeBoundedInteger(
      schema.minLength,
      0,
      state.maxResultBytes,
      'minLength',
      path
    )
    output.maxLength =
      schema.maxLength === undefined
        ? state.maxResultBytes
        : normalizeBoundedInteger(schema.maxLength, 0, state.maxResultBytes, 'maxLength', path)
    assertOrderedBounds(output.minLength, output.maxLength, 'string length', path)
  } else {
    rejectKeywords(schema, ['minLength', 'maxLength'], path)
  }

  if (
    schema.type === undefined &&
    schema.enum === undefined &&
    schema.const === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.allOf === undefined &&
    schema.not === undefined
  ) {
    throw schemaError(`Schema node at ${path} must constrain its value.`)
  }
  return output
}

function normalizeTypes(value: JsonValue | undefined, path: string): Set<string> {
  if (typeof value === 'string') {
    if (!JSON_SCHEMA_TYPES.has(value)) {
      throw schemaError(`Unsupported JSON Schema type "${value}" at ${path}.`)
    }
    return new Set([value])
  }
  if (Array.isArray(value)) {
    if (value.length < 1 || value.some((item) => typeof item !== 'string')) {
      throw schemaError(`"type" at ${path} must contain JSON Schema type names.`)
    }
    const types = new Set(value as string[])
    if (types.size !== value.length || [...types].some((type) => !JSON_SCHEMA_TYPES.has(type))) {
      throw schemaError(`"type" at ${path} contains duplicate or unsupported types.`)
    }
    if (types.size !== 2 || !types.has('null')) {
      throw schemaError(`"type" arrays at ${path} may only add null to one concrete type.`)
    }
    return types
  }
  if (value !== undefined) {
    throw schemaError(`"type" at ${path} must be a string or string array.`)
  }
  return new Set()
}

function normalizeCombinator(
  schema: Record<string, JsonValue>,
  output: Record<string, JsonValue>,
  keyword: 'anyOf' | 'oneOf' | 'allOf',
  path: string,
  depth: number,
  state: { nodes: number; maxResultBytes: number }
): void {
  const value = schema[keyword]
  if (value === undefined) {
    return
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_COMBINATOR_BRANCHES) {
    throw schemaError(`"${keyword}" at ${path} must contain 1-${MAX_COMBINATOR_BRANCHES} schemas.`)
  }
  output[keyword] = value.map((branch, index) => {
    if (!isJsonObject(branch)) {
      throw schemaError(`"${keyword}" branch ${index} at ${path} must be a schema object.`)
    }
    return normalizeSchemaNode(branch, `${path}.${keyword}[${index}]`, depth + 1, state)
  })
}

function copyBoundedText(
  source: Record<string, JsonValue>,
  target: Record<string, JsonValue>,
  key: 'title' | 'description',
  maxLength: number,
  path: string
): void {
  const value = source[key]
  if (value === undefined) {
    return
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw schemaError(`"${key}" at ${path} must be a string of at most ${maxLength} characters.`)
  }
  target[key] = value
}

function copyNumberKeyword(
  source: Record<string, JsonValue>,
  target: Record<string, JsonValue>,
  key: 'minimum' | 'maximum' | 'exclusiveMinimum' | 'exclusiveMaximum',
  path: string
): void {
  const value = source[key]
  if (value === undefined) {
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw schemaError(`"${key}" at ${path} must be a finite number.`)
  }
  target[key] = value
}

function copyPositiveNumberKeyword(
  source: Record<string, JsonValue>,
  target: Record<string, JsonValue>,
  key: 'multipleOf',
  path: string
): void {
  const value = source[key]
  if (value === undefined) {
    return
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw schemaError(`"${key}" at ${path} must be a positive finite number.`)
  }
  target[key] = value
}

function normalizeBoundedInteger(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
  keyword: string,
  path: string
): number {
  if (value === undefined) {
    return minimum
  }
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw schemaError(`"${keyword}" at ${path} must be an integer in ${minimum}-${maximum}.`)
  }
  return value as number
}

function assertOrderedBounds(
  minimum: JsonValue | undefined,
  maximum: JsonValue | undefined,
  label: string,
  path: string
): void {
  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    throw schemaError(`Minimum ${label} exceeds maximum ${label} at ${path}.`)
  }
}

function rejectKeywords(schema: Record<string, JsonValue>, keywords: string[], path: string): void {
  const invalid = keywords.find((keyword) => schema[keyword] !== undefined)
  if (invalid) {
    throw schemaError(`"${invalid}" at ${path} requires the matching JSON Schema type.`)
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x1f) {
      return true
    }
  }
  return false
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return 'Structured result does not match its JSON Schema.'
  }
  const details = errors
    .slice(0, MAX_VALIDATION_ERRORS)
    .map((error) => {
      const location = error.instancePath || '$'
      return `${location} ${error.message ?? `failed ${error.keyword}`}`.trim()
    })
    .join('; ')
  const suffix = errors.length > MAX_VALIDATION_ERRORS ? '; additional errors omitted' : ''
  return `Structured result is invalid: ${details}${suffix}`.slice(0, MAX_VALIDATION_MESSAGE_LENGTH)
}

function schemaError(message: string, cause?: unknown): WorkflowStructuredOutputError {
  return new WorkflowStructuredOutputError(
    'STRUCTURED_SCHEMA_INVALID',
    message.slice(0, MAX_VALIDATION_MESSAGE_LENGTH),
    false,
    cause === undefined ? undefined : { cause }
  )
}

function resultError(message: string, cause?: unknown): WorkflowStructuredOutputError {
  const normalized =
    message ||
    (cause instanceof WorkflowJsonError
      ? cause.message
      : 'Workflow structured-output result is invalid.')
  return new WorkflowStructuredOutputError(
    'STRUCTURED_RESULT_INVALID',
    normalized.slice(0, MAX_VALIDATION_MESSAGE_LENGTH),
    false,
    cause === undefined ? undefined : { cause }
  )
}

function toBoundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_VALIDATION_MESSAGE_LENGTH
  )
}
