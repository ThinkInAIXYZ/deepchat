import type { MCPToolDefinition } from '@shared/types/mcp'
import type { AiSdkFetch, AiSdkProviderKind } from './providerFactory'
import { normalizeToolInputSchema } from './toolMapper'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// The Google SDK's OpenAPI conversion loses constraints from property intersections.
// Keep a request-local copy before conversion, and use the JSON Schema field only
// for root allOf tool declarations with property intersections.
export function createGeminiToolSchemaAdapter(
  providerKind: AiSdkProviderKind,
  tools: MCPToolDefinition[]
): ((baseFetch: AiSdkFetch) => AiSdkFetch) | undefined {
  if (providerKind !== 'gemini' && providerKind !== 'vertex') return undefined

  const schemas = new Map<string, Record<string, unknown>>()
  for (const tool of tools) {
    const name = tool.function.name
    // Match the mapper's last-definition-wins behavior, including freeform tools.
    schemas.delete(name)
    if (
      !name ||
      ['__proto__', 'constructor', 'prototype'].includes(name) ||
      tool.providerPresentation?.type === 'freeform'
    ) {
      continue
    }
    const inputSchema: unknown = tool.raw?.inputSchema ?? tool.function.parameters
    if (
      !isRecord(inputSchema) ||
      !Array.isArray(inputSchema.allOf) ||
      Array.isArray(inputSchema.anyOf) ||
      Array.isArray(inputSchema.oneOf)
    ) {
      continue
    }
    const schema = normalizeToolInputSchema(inputSchema)
    if (
      isRecord(schema.properties) &&
      Object.values(schema.properties).some(
        (property) => isRecord(property) && Array.isArray(property.allOf)
      )
    ) {
      schemas.set(name, schema)
    }
  }
  if (schemas.size === 0) return undefined

  return (baseFetch) => async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (
      !/:(?:generateContent|streamGenerateContent)(?:\?|$)/.test(url) ||
      typeof init?.body !== 'string'
    ) {
      return baseFetch(input, init)
    }
    let body: unknown
    try {
      body = JSON.parse(init.body)
    } catch {
      return baseFetch(input, init)
    }
    if (!isRecord(body) || !Array.isArray(body.tools)) return baseFetch(input, init)

    let changed = false
    for (const tool of body.tools) {
      if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) continue
      for (const declaration of tool.functionDeclarations) {
        if (!isRecord(declaration) || typeof declaration.name !== 'string') continue
        const schema = schemas.get(declaration.name)
        if (!schema) continue
        declaration.parametersJsonSchema = schema
        delete declaration.parameters
        changed = true
      }
    }
    return baseFetch(input, changed ? { ...init, body: JSON.stringify(body) } : init)
  }
}
