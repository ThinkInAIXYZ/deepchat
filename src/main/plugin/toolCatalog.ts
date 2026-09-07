import fs from 'node:fs'

import type { Tool } from '@shared/types/mcp'
import { validateAndCloneJsonSchema } from '@/mcp/schemaValidation'

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export interface PluginToolCatalog {
  readonly version: string
  readonly tools: readonly Tool[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue)
  }
  return Object.freeze(value)
}

const catalogError = (source: string, detail: string): Error =>
  new Error(`Invalid plugin MCP tool catalog "${source}": ${detail}`)

const validateCatalogInputSchema = (
  inputSchema: Record<string, unknown>,
  source: string,
  location: string
): Record<string, unknown> => {
  try {
    return validateAndCloneJsonSchema(inputSchema, `${location}.input_schema`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw catalogError(source, detail)
  }
}

export const parsePluginToolCatalog = (
  input: unknown,
  source = '<in-memory>'
): PluginToolCatalog => {
  if (!isRecord(input)) {
    throw catalogError(source, 'root must be an object')
  }

  const version = typeof input.version === 'string' ? input.version.trim() : ''
  if (!version) {
    throw catalogError(source, 'version must be a non-empty string')
  }
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    throw catalogError(source, 'tools must be a non-empty array')
  }

  const names = new Set<string>()
  const tools = input.tools.map((rawTool, index): Tool => {
    const location = `tools[${index}]`
    if (!isRecord(rawTool)) {
      throw catalogError(source, `${location} must be an object`)
    }

    const name = typeof rawTool.name === 'string' ? rawTool.name.trim() : ''
    if (!name || name !== rawTool.name || !TOOL_NAME_PATTERN.test(name)) {
      throw catalogError(source, `${location}.name must match ${TOOL_NAME_PATTERN}`)
    }
    if (names.has(name)) {
      throw catalogError(source, `duplicate tool name: ${name}`)
    }
    names.add(name)

    const description = typeof rawTool.description === 'string' ? rawTool.description.trim() : ''
    if (!description) {
      throw catalogError(source, `${location}.description must be a non-empty string`)
    }

    if (!isRecord(rawTool.input_schema)) {
      throw catalogError(source, `${location}.input_schema must be an object`)
    }
    const inputSchema = rawTool.input_schema
    if (inputSchema.type !== 'object' || !isRecord(inputSchema.properties)) {
      throw catalogError(
        source,
        `${location}.input_schema must declare type "object" and object properties`
      )
    }
    if (
      inputSchema.required !== undefined &&
      (!Array.isArray(inputSchema.required) ||
        inputSchema.required.some((item) => typeof item !== 'string') ||
        new Set(inputSchema.required).size !== inputSchema.required.length)
    ) {
      throw catalogError(source, `${location}.input_schema.required must contain unique strings`)
    }

    const readOnly = rawTool.read_only
    const destructive = rawTool.destructive
    const idempotent = rawTool.idempotent
    if (typeof readOnly !== 'boolean') {
      throw catalogError(source, `${location}.read_only must be a boolean`)
    }
    if (typeof destructive !== 'boolean') {
      throw catalogError(source, `${location}.destructive must be a boolean`)
    }
    if (typeof idempotent !== 'boolean') {
      throw catalogError(source, `${location}.idempotent must be a boolean`)
    }

    return {
      name,
      description,
      inputSchema: validateCatalogInputSchema(inputSchema, source, location),
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        idempotentHint: idempotent
      }
    }
  })

  return deepFreeze({ version, tools })
}

export const parsePluginToolCatalogJson = (
  contents: string,
  source = '<in-memory>'
): PluginToolCatalog => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw catalogError(source, `cannot read JSON: ${detail}`)
  }
  return parsePluginToolCatalog(parsed, source)
}

export const loadPluginToolCatalog = (catalogPath: string): PluginToolCatalog =>
  parsePluginToolCatalogJson(fs.readFileSync(catalogPath, 'utf8'), catalogPath)
