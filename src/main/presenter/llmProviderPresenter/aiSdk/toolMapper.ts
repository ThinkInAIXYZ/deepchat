import type { MCPToolDefinition } from '@shared/presenter'
import { jsonSchema, tool, type ToolSet } from 'ai'

type JsonSchema = Record<string, unknown>
const UNSAFE_TOOL_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

function isObjectSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function intersectRequiredKeys(variants: JsonSchema[]): string[] | undefined {
  if (!variants.length) {
    return undefined
  }

  const requiredLists = variants.map((variant) =>
    Array.isArray(variant.required)
      ? variant.required.filter((key): key is string => typeof key === 'string')
      : []
  )

  const [first, ...rest] = requiredLists
  const intersection = first.filter((key) => rest.every((required) => required.includes(key)))

  return intersection.length > 0 ? intersection : undefined
}

function unionRequiredKeys(variants: JsonSchema[]): string[] | undefined {
  const union = Array.from(
    new Set(
      variants.flatMap((variant) =>
        Array.isArray(variant.required)
          ? variant.required.filter((key): key is string => typeof key === 'string')
          : []
      )
    )
  )

  return union.length > 0 ? union : undefined
}

function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (!isObjectSchema(existing) || !isObjectSchema(incoming)) {
    return incoming
  }

  if (JSON.stringify(existing) === JSON.stringify(incoming)) {
    return existing
  }

  if (
    existing.type === incoming.type &&
    typeof existing.const === 'string' &&
    typeof incoming.const === 'string'
  ) {
    return {
      type: existing.type,
      enum: Array.from(new Set([existing.const, incoming.const]))
    }
  }

  return {
    anyOf: [existing, incoming]
  }
}

function mergeVariantProperties(variants: JsonSchema[]): Record<string, unknown> | undefined {
  const propertyMaps = variants
    .map((variant) => (isObjectSchema(variant.properties) ? variant.properties : undefined))
    .filter((value): value is Record<string, unknown> => Boolean(value))

  if (!propertyMaps.length) {
    return undefined
  }

  const merged: Record<string, unknown> = {}

  for (const propertyMap of propertyMaps) {
    for (const [key, value] of Object.entries(propertyMap)) {
      merged[key] = key in merged ? mergePropertySchemas(merged[key], value) : value
    }
  }

  return merged
}

function normalizeSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeSchemaNode(item))
  }

  if (!isObjectSchema(node)) {
    return node
  }

  const normalized: JsonSchema = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, normalizeSchemaNode(value)])
  )

  if (typeof normalized.type === 'string' && normalized.type.toLowerCase() === 'none') {
    delete normalized.type
  }

  return normalized
}

export function normalizeToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeSchemaNode(schema)
  if (!isObjectSchema(normalized)) {
    return {
      type: 'object',
      properties: {}
    }
  }

  if (normalized.type === 'object') {
    return normalized
  }

  const branchKey = ['anyOf', 'oneOf', 'allOf'].find((key) => Array.isArray(normalized[key]))
  const variants = branchKey
    ? (normalized[branchKey] as unknown[])
        .filter(isObjectSchema)
        .filter((item) => item.type === 'object')
    : []

  if (!variants.length) {
    const required = Array.isArray(normalized.required)
      ? normalized.required.filter((key): key is string => typeof key === 'string')
      : undefined
    const additionalProperties =
      typeof normalized.additionalProperties === 'boolean' ||
      isObjectSchema(normalized.additionalProperties)
        ? normalized.additionalProperties
        : undefined

    return {
      type: 'object',
      properties: isObjectSchema(normalized.properties) ? normalized.properties : {},
      ...(required?.length ? { required } : {}),
      ...(additionalProperties !== undefined ? { additionalProperties } : {})
    }
  }

  const { type: _type, properties: _properties, required: _required, ...rest } = normalized
  const sanitizedRest = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !['anyOf', 'oneOf', 'allOf'].includes(key))
  )
  const required =
    branchKey === 'allOf' ? unionRequiredKeys(variants) : intersectRequiredKeys(variants)

  return {
    ...sanitizedRest,
    type: 'object',
    properties: mergeVariantProperties(variants) ?? {},
    ...(required ? { required } : {}),
    ...(variants.every((variant) => variant.additionalProperties === false)
      ? { additionalProperties: false }
      : {})
  }
}

export function mcpToolsToAISDKTools(tools: MCPToolDefinition[]): ToolSet {
  return tools.reduce<ToolSet>(
    (acc, toolDef) => {
      const name = toolDef.function.name
      if (!name || UNSAFE_TOOL_NAMES.has(name)) {
        return acc
      }

      acc[name] = tool({
        description: toolDef.function.description,
        inputSchema: jsonSchema(normalizeToolInputSchema(toolDef.function.parameters as JsonSchema))
      })

      return acc
    },
    Object.create(null) as ToolSet
  )
}
