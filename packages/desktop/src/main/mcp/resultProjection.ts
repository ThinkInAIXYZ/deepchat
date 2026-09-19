import type {
  MCPContentItem,
  MCPServerConfig,
  McpAppDescriptor,
  PersistedMcpToolResult,
  Tool,
  ToolCallResult
} from '@shared/types/mcp'

const MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const MAX_PERSISTED_MCP_RESULT_BYTES = 2 * 1024 * 1024
const MAX_PERSISTED_MCP_VALUE_DEPTH = 24
const MAX_PERSISTED_MCP_KEYS = 10_000

type BoundedCloneState = {
  keys: number
  truncated: boolean
}

const serializedBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const cloneBoundedJson = (value: unknown, state: BoundedCloneState, depth = 0): unknown => {
  if (depth > MAX_PERSISTED_MCP_VALUE_DEPTH) {
    state.truncated = true
    return undefined
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    const output: unknown[] = []
    for (const item of value) {
      const cloned = cloneBoundedJson(item, state, depth + 1)
      if (cloned !== undefined) {
        output.push(cloned)
      }
    }
    return output
  }
  if (typeof value !== 'object') {
    state.truncated = true
    return undefined
  }

  const output = Object.create(null) as Record<string, unknown>
  for (const [key, item] of Object.entries(value)) {
    state.keys += 1
    if (state.keys > MAX_PERSISTED_MCP_KEYS) {
      state.truncated = true
      break
    }
    const cloned = cloneBoundedJson(item, state, depth + 1)
    if (cloned !== undefined) {
      output[key] = cloned
    }
  }
  return output
}

const cloneContentForPersistence = (
  content: MCPContentItem[],
  state: BoundedCloneState
): MCPContentItem[] => {
  const durable: MCPContentItem[] = []

  for (const item of content) {
    const cloned = cloneBoundedJson(item, state) as MCPContentItem | undefined
    if (cloned) {
      durable.push(cloned)
    }
  }

  return durable
}

const readUiMeta = (tool: Tool): Record<string, unknown> | undefined => {
  const meta = tool._meta
  if (!meta || typeof meta !== 'object') {
    return undefined
  }
  const nested = meta.ui
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : undefined
}

export const getToolUiResourceUri = (tool: Tool): string | undefined => {
  const uiMeta = readUiMeta(tool)
  const hasNestedUri = Boolean(
    uiMeta && Object.prototype.hasOwnProperty.call(uiMeta, 'resourceUri')
  )
  const nestedUri = uiMeta?.resourceUri
  const legacyUri = tool._meta?.['ui/resourceUri']
  const resourceUri = hasNestedUri
    ? typeof nestedUri === 'string'
      ? nestedUri
      : undefined
    : typeof legacyUri === 'string'
      ? legacyUri
      : undefined
  if (!resourceUri) {
    return undefined
  }
  try {
    const url = new URL(resourceUri)
    if (url.protocol !== 'ui:' || !url.hostname || url.username || url.password) {
      return undefined
    }
  } catch {
    return undefined
  }
  return resourceUri
}

export const getToolVisibility = (tool: Tool): Array<'model' | 'app'> => {
  const raw = readUiMeta(tool)?.visibility
  if (!Array.isArray(raw)) {
    return ['model', 'app']
  }
  const visibility = raw.filter(
    (value): value is 'model' | 'app' => value === 'model' || value === 'app'
  )
  return Array.from(new Set(visibility))
}

const createMcpAppDescriptor = (
  tool: Tool,
  config: MCPServerConfig,
  serverName: string
): McpAppDescriptor | undefined => {
  const resourceUri = getToolUiResourceUri(tool)
  if (!resourceUri || !config.serverId || !config.bindingHash) {
    return undefined
  }
  return {
    schemaVersion: 1,
    serverId: config.serverId,
    configGeneration: config.configGeneration ?? 1,
    bindingHash: config.bindingHash,
    serverName,
    toolName: tool.name,
    resourceUri,
    resourceMimeType: MCP_APP_RESOURCE_MIME_TYPE
  }
}

export const createPersistedMcpToolResult = (input: {
  tool: Tool
  config: MCPServerConfig
  serverName: string
  result: ToolCallResult
}): PersistedMcpToolResult | undefined => {
  const { config, result, serverName, tool } = input
  if (!config.serverId || !config.bindingHash) {
    return undefined
  }

  const contentState: BoundedCloneState = { keys: 0, truncated: false }
  const content = cloneContentForPersistence(result.content ?? [], contentState)
  let binaryContentOmitted = false
  const structuredState: BoundedCloneState = { keys: 0, truncated: false }
  const structuredContent =
    result.structuredContent === undefined
      ? undefined
      : cloneBoundedJson(result.structuredContent, structuredState)
  const metaState: BoundedCloneState = { keys: 0, truncated: false }
  const meta =
    result._meta === undefined
      ? undefined
      : (cloneBoundedJson(result._meta, metaState) as Record<string, unknown> | undefined)

  const app = createMcpAppDescriptor(tool, config, serverName)
  const durable: PersistedMcpToolResult = {
    schemaVersion: 1,
    serverId: config.serverId,
    configGeneration: config.configGeneration ?? 1,
    bindingHash: config.bindingHash,
    toolName: tool.name,
    ...(result.isError ? { isError: true } : {}),
    ...(content.length > 0 ? { content } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(meta ? { meta } : {}),
    ...(app ? { app } : {})
  }

  if (serializedBytes(durable) > MAX_PERSISTED_MCP_RESULT_BYTES && durable.content) {
    const withoutBinary: MCPContentItem[] = []
    for (const item of durable.content) {
      if (item.type === 'image' || item.type === 'audio') {
        binaryContentOmitted = true
        continue
      }
      if (item.type === 'resource' && 'blob' in item.resource && item.resource.blob) {
        binaryContentOmitted = true
        const resource = { ...item.resource }
        delete resource.blob
        withoutBinary.push({ ...item, resource })
        continue
      }
      withoutBinary.push(item)
    }
    durable.content = withoutBinary
  }
  if (serializedBytes(durable) > MAX_PERSISTED_MCP_RESULT_BYTES) {
    delete durable.structuredContent
    structuredState.truncated = true
  }
  if (serializedBytes(durable) > MAX_PERSISTED_MCP_RESULT_BYTES) {
    delete durable.meta
    metaState.truncated = true
  }
  if (serializedBytes(durable) > MAX_PERSISTED_MCP_RESULT_BYTES) {
    delete durable.content
    contentState.truncated = true
  }

  const truncated = {
    ...(contentState.truncated ? { content: true } : {}),
    ...(structuredState.truncated ? { structuredContent: true } : {}),
    ...(metaState.truncated ? { meta: true } : {}),
    ...(binaryContentOmitted ? { binaryContentOmitted: true } : {})
  }
  if (Object.keys(truncated).length > 0) {
    durable.truncated = truncated
  }

  return durable
}
