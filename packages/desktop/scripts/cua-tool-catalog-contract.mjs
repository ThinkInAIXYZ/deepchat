import fs from 'node:fs'

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (source, detail) => {
  throw new Error(`Invalid CUA MCP tool catalog "${source}": ${detail}`)
}

export function parseCuaToolCatalog(input, source = '<in-memory>') {
  if (!isRecord(input)) {
    fail(source, 'root must be an object')
  }
  const version = typeof input.version === 'string' ? input.version.trim() : ''
  if (!version) {
    fail(source, 'version must be a non-empty string')
  }
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    fail(source, 'tools must be a non-empty array')
  }

  const names = new Set()
  const tools = input.tools.map((rawTool, index) => {
    const location = `tools[${index}]`
    if (!isRecord(rawTool)) {
      fail(source, `${location} must be an object`)
    }
    const name = typeof rawTool.name === 'string' ? rawTool.name.trim() : ''
    if (!name || name !== rawTool.name || !TOOL_NAME_PATTERN.test(name)) {
      fail(source, `${location}.name must match ${TOOL_NAME_PATTERN}`)
    }
    if (names.has(name)) {
      fail(source, `duplicate tool name: ${name}`)
    }
    names.add(name)

    const description =
      typeof rawTool.description === 'string' ? rawTool.description.trim() : ''
    if (!description) {
      fail(source, `${location}.description must be a non-empty string`)
    }
    if (!isRecord(rawTool.input_schema)) {
      fail(source, `${location}.input_schema must be an object`)
    }
    if (
      rawTool.input_schema.type !== 'object' ||
      !isRecord(rawTool.input_schema.properties)
    ) {
      fail(
        source,
        `${location}.input_schema must declare type "object" and object properties`
      )
    }
    const required = rawTool.input_schema.required
    if (
      required !== undefined &&
      (!Array.isArray(required) ||
        required.some((item) => typeof item !== 'string') ||
        new Set(required).size !== required.length)
    ) {
      fail(source, `${location}.input_schema.required must contain unique strings`)
    }
    for (const field of ['read_only', 'destructive', 'idempotent']) {
      if (typeof rawTool[field] !== 'boolean') {
        fail(source, `${location}.${field} must be a boolean`)
      }
    }

    return {
      name,
      description,
      input_schema: JSON.parse(JSON.stringify(rawTool.input_schema)),
      read_only: rawTool.read_only,
      destructive: rawTool.destructive,
      idempotent: rawTool.idempotent
    }
  })

  return { version, tools }
}

export function readCuaToolCatalog(catalogPath) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    fail(catalogPath, `cannot read JSON: ${error instanceof Error ? error.message : error}`)
  }
  return parseCuaToolCatalog(parsed, catalogPath)
}
