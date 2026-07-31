import { createHash } from 'node:crypto'
import { shell } from 'electron'
import type { PermissionMode } from '@shared/types/agent-interface'
import type {
  MCPContentItem,
  McpAppCallToolResult,
  McpAppCsp,
  McpAppHostPort,
  McpAppPermissions,
  McpAppPreparedView,
  McpAppDescriptor,
  McpAppServerPromptListResult,
  McpAppServerResourceListResult,
  McpAppServerResourceTemplateListResult,
  McpAppServerToolListResult,
  Resource,
  Tool,
  ToolCallResult
} from '@shared/types/mcp'
import type { McpSettings } from '../settings'
import type { ServerManager } from '../serverManager'
import { getToolUiResourceUri, getToolVisibility } from '../resultProjection'
import type { ToolPermissionBroker } from '@/tool/permission'
import type {
  McpAppSandboxInstance,
  McpAppSandboxRegistry,
  McpAppRouteContext
} from './sandboxRegistry'
import { MCP_APP_SCHEME } from './sandboxRegistry'
import { assertBoundedMcpJson } from '../schemaValidation'
import { resolvePluginToolPolicy } from '@/plugin/toolPolicyStore'

const MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const MAX_APP_HTML_BYTES = 2 * 1024 * 1024
const MAX_APP_ACTION_BYTES = 2 * 1024 * 1024
const MAX_APP_TOOL_RESULT_BYTES = 8 * 1024 * 1024
const MAX_APP_CONTEXT_BYTES = 256 * 1024
const MAX_APP_MESSAGE_LENGTH = 32 * 1024
const MAX_CONSENT_DETAIL_LENGTH = 32 * 1024
const MAX_CSP_DOMAINS = 64
const MAX_CSP_SOURCE_LENGTH = 2048
const MAX_RESOURCE_LIST_PAGES = 64

const serializedBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readUiMeta = (resource: Pick<Resource, '_meta'>): Record<string, unknown> | undefined => {
  const nested = resource._meta?.ui
  return isRecord(nested) ? nested : undefined
}

const normalizeCspSource = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null
  }
  const value = raw.trim()
  if (!value || value.length > MAX_CSP_SOURCE_LENGTH || value === '*') {
    return null
  }

  const wildcard = value.match(/^(https|wss):\/\/\*\.([a-z0-9.-]+)(?::([0-9]+))?$/i)
  if (wildcard) {
    const hostname = wildcard[2].toLowerCase()
    if (!hostname.includes('.') || hostname === 'localhost') {
      return null
    }
    return `${wildcard[1].toLowerCase()}://*.${hostname}${wildcard[3] ? `:${wildcard[3]}` : ''}`
  }

  try {
    const url = new URL(value)
    const isLoopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    const allowedProtocol =
      url.protocol === 'https:' ||
      url.protocol === 'wss:' ||
      (isLoopback && (url.protocol === 'http:' || url.protocol === 'ws:'))
    if (
      !allowedProtocol ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

const normalizeCspSources = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const values = Array.from(
    new Set(raw.slice(0, MAX_CSP_DOMAINS).map(normalizeCspSource).filter(Boolean))
  ) as string[]
  return values.length > 0 ? values : undefined
}

const normalizeCsp = (raw: unknown): McpAppCsp | undefined => {
  if (!isRecord(raw)) {
    return undefined
  }
  const normalized: McpAppCsp = {
    connectDomains: normalizeCspSources(raw.connectDomains),
    resourceDomains: normalizeCspSources(raw.resourceDomains),
    frameDomains: normalizeCspSources(raw.frameDomains),
    baseUriDomains: normalizeCspSources(raw.baseUriDomains)
  }
  return Object.values(normalized).some(Boolean) ? normalized : undefined
}

const normalizePermissions = (raw: unknown): McpAppPermissions | undefined => {
  if (!isRecord(raw)) {
    return undefined
  }
  const normalized: McpAppPermissions = {
    ...(isRecord(raw.camera) ? { camera: {} } : {}),
    ...(isRecord(raw.microphone) ? { microphone: {} } : {}),
    ...(isRecord(raw.geolocation) ? { geolocation: {} } : {}),
    ...(isRecord(raw.clipboardWrite) ? { clipboardWrite: {} } : {})
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

const normalizeAdvisoryDomain = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') {
    return undefined
  }
  const value = raw.trim().toLowerCase()
  return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(value) ? value : undefined
}

const decodeResourceHtml = (resource: Resource): string => {
  if (typeof resource.text === 'string') {
    if (Buffer.byteLength(resource.text, 'utf8') > MAX_APP_HTML_BYTES) {
      throw new Error('MCP App HTML exceeds the 2 MiB limit')
    }
    return resource.text
  }
  if (typeof resource.blob !== 'string' || !resource.blob) {
    throw new Error('MCP App resource does not contain HTML')
  }
  const normalized = resource.blob.replace(/\s+/g, '')
  if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new Error('MCP App resource contains invalid base64')
  }
  const decoded = Buffer.from(normalized, 'base64')
  if (
    decoded.length > MAX_APP_HTML_BYTES ||
    decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')
  ) {
    throw new Error('MCP App resource contains invalid or oversized base64')
  }
  return decoded.toString('utf8')
}

const normalizeExternalUrl = (value: string): string => {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('MCP Apps may open only HTTP(S) links without embedded credentials')
  }
  return url.toString()
}

const createErrorToolResult = (message: string): ToolCallResult => ({
  isError: true,
  content: [{ type: 'text', text: message }]
})

type BoundServer = {
  serverName: string
  client: NonNullable<ReturnType<ServerManager['getClient']>>
}

export class McpAppHost implements McpAppHostPort {
  constructor(
    private readonly deps: {
      settings: McpSettings
      serverManager: ServerManager
      permissionBroker: ToolPermissionBroker
      registry: McpAppSandboxRegistry
      ensureServerRunning(serverName: string): Promise<void>
      getPermissionMode(conversationId: string): Promise<PermissionMode>
      validateSource(input: {
        descriptor: McpAppDescriptor
        conversationId: string
        messageId: string
        blockId: string
        toolInput: Record<string, unknown>
      }): boolean
      persistModelContext(
        messageId: string,
        blockId: string,
        descriptor: McpAppDescriptor,
        toolInput: Record<string, unknown>,
        context: {
          content?: MCPContentItem[]
          structuredContent?: Record<string, unknown>
          approvedHash: string
        }
      ): boolean
    }
  ) {}

  async prepareView(
    input: {
      descriptor: McpAppDescriptor
      conversationId: string
      messageId: string
      blockId: string
      toolInput: Record<string, unknown>
    },
    context: McpAppRouteContext
  ): Promise<McpAppPreparedView> {
    assertBoundedMcpJson(input.toolInput, 'MCP App tool input', MAX_APP_ACTION_BYTES)
    if (!this.deps.validateSource(input)) {
      throw new Error('The MCP App source no longer matches the saved tool result')
    }
    const bound = await this.resolveBoundServer(input.descriptor)
    const tools = await bound.client.listTools()
    await this.assertBoundServerCurrent(input.descriptor, bound)
    const tool = tools.find((entry) => entry.name === input.descriptor.toolName)
    if (!tool || getToolUiResourceUri(tool) !== input.descriptor.resourceUri) {
      throw new Error('MCP App tool declaration no longer matches the saved result')
    }

    const resources = await bound.client.readResourceContents(input.descriptor.resourceUri)
    await this.assertBoundServerCurrent(input.descriptor, bound)
    const matching = resources.filter((entry) => entry.uri === input.descriptor.resourceUri)
    if (matching.length !== 1) {
      throw new Error('MCP App resource must return exactly one matching content item')
    }
    const resource = matching[0]
    if (resource.mimeType !== MCP_APP_RESOURCE_MIME_TYPE) {
      throw new Error(`Unsupported MCP App resource MIME type: ${resource.mimeType ?? 'missing'}`)
    }

    const html = decodeResourceHtml(resource)
    const uiMeta =
      readUiMeta(resource) ??
      (await this.findListedResourceUiMeta(bound.client, input.descriptor.resourceUri))
    await this.assertBoundServerCurrent(input.descriptor, bound)
    if (!this.deps.validateSource(input)) {
      throw new Error('The MCP App source no longer matches the saved tool result')
    }
    const instance = this.deps.registry.create({
      context,
      conversationId: input.conversationId,
      messageId: input.messageId,
      blockId: input.blockId,
      descriptor: { ...input.descriptor, serverName: bound.serverName },
      toolInput: input.toolInput,
      html,
      csp: normalizeCsp(uiMeta?.csp),
      permissions: normalizePermissions(uiMeta?.permissions),
      prefersBorder: typeof uiMeta?.prefersBorder === 'boolean' ? uiMeta.prefersBorder : undefined,
      advisoryDomain: normalizeAdvisoryDomain(uiMeta?.domain),
      validateLive: () => this.deps.validateSource(input)
    })

    return {
      instanceId: instance.instanceId,
      sandboxUrl: `${MCP_APP_SCHEME}://${instance.instanceId}/sandbox.html`,
      html: instance.html,
      sandbox: 'allow-scripts allow-same-origin',
      tool,
      csp: instance.csp,
      permissions: instance.permissions,
      prefersBorder: instance.prefersBorder,
      advisoryDomain: instance.advisoryDomain,
      expiresAt: instance.expiresAt
    }
  }

  async releaseView(instanceId: string, context: McpAppRouteContext): Promise<void> {
    this.deps.registry.assertOwned(instanceId, context)
    this.deps.registry.revoke(instanceId)
  }

  async callTool(
    instanceId: string,
    name: string,
    args: Record<string, unknown>,
    context: McpAppRouteContext
  ): Promise<McpAppCallToolResult> {
    assertBoundedMcpJson(args, 'MCP App tool arguments', MAX_APP_ACTION_BYTES)
    const instance = this.assertLiveInstance(instanceId, context)
    if (instance.toolAccessSuspended) {
      return {
        result: createErrorToolResult('Tool access is suspended until the host retries it'),
        toolAccessSuspended: true
      }
    }

    const bound = await this.resolveBoundServer(instance.descriptor)
    const tools = await bound.client.listTools()
    const tool = tools.find((entry) => entry.name === name)
    if (
      !tool ||
      !getToolVisibility(tool).includes('app') ||
      !this.isToolAllowedByPluginPolicy(bound.serverName, tool.name)
    ) {
      return {
        result: createErrorToolResult('The requested tool is not available to this MCP App'),
        toolAccessSuspended: false
      }
    }

    const permissionMode = await this.deps
      .getPermissionMode(instance.conversationId)
      .catch(() => 'default' as PermissionMode)
    const decision = await this.deps.permissionBroker.requestAppDecision(
      {
        conversationId: instance.conversationId,
        serverId: instance.descriptor.serverId,
        configGeneration: instance.descriptor.configGeneration,
        bindingHash: instance.descriptor.bindingHash,
        serverName: bound.serverName,
        toolName: name,
        arguments: args,
        // App-visible server annotations remain advisory and cannot weaken host policy.
        permissionType: 'write',
        permissionMode
      },
      (request) => {
        const requestId = request.requestId
        if (!requestId) {
          throw new Error('MCP App tool permission request is missing its request ID')
        }
        void this.deps.registry
          .requestConsent(instance, {
            requestId,
            kind: 'tool-call',
            title: name,
            detail: bound.serverName,
            argumentsPreview:
              typeof request.argumentsPreview === 'string' ? request.argumentsPreview : undefined
          })
          .then((approved) => {
            if (approved) {
              this.deps.permissionBroker.approve(requestId, instance.conversationId)
            } else {
              this.deps.permissionBroker.deny(requestId, instance.conversationId)
            }
          })
          .catch(() => {
            this.deps.permissionBroker.deny(requestId, instance.conversationId)
          })
      }
    )

    if (!decision.allowed) {
      this.assertLiveInstance(instanceId, context)
      await this.assertDescriptorCurrent(instance.descriptor)
      instance.toolAccessSuspended = true
      return {
        result: createErrorToolResult('The user denied this MCP App tool call'),
        toolAccessSuspended: true
      }
    }

    this.assertLiveInstance(instanceId, context)
    const currentBound = await this.resolveBoundServer(instance.descriptor)
    const currentTools = await currentBound.client.listTools()
    await this.assertBoundServerCurrent(instance.descriptor, currentBound)
    const currentTool = currentTools.find((entry) => entry.name === name)
    if (
      !currentTool ||
      !getToolVisibility(currentTool).includes('app') ||
      !this.isToolAllowedByPluginPolicy(currentBound.serverName, currentTool.name)
    ) {
      return {
        result: createErrorToolResult('The requested tool is no longer available to this MCP App'),
        toolAccessSuspended: false
      }
    }
    const result = await currentBound.client.callTool(name, args, {
      toolDefinition: currentTool
    })
    if (serializedBytes(result) > MAX_APP_TOOL_RESULT_BYTES) {
      return {
        result: createErrorToolResult('The MCP App tool result exceeded the host limit'),
        toolAccessSuspended: false
      }
    }
    return { result, toolAccessSuspended: false }
  }

  async listTools(
    instanceId: string,
    cursor: string | undefined,
    context: McpAppRouteContext
  ): Promise<McpAppServerToolListResult> {
    const instance = this.assertLiveInstance(instanceId, context)
    const bound = await this.resolveBoundServer(instance.descriptor)
    const result = await bound.client.listToolsPage(cursor)
    await this.assertBoundServerCurrent(instance.descriptor, bound)
    const output: McpAppServerToolListResult = {
      tools: (result.tools as unknown as Tool[]).filter(
        (tool) =>
          getToolVisibility(tool).includes('app') &&
          this.isToolAllowedByPluginPolicy(bound.serverName, tool.name)
      ),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result._meta ? { _meta: result._meta } : {})
    }
    assertBoundedMcpJson(output, 'MCP App tool list', MAX_APP_ACTION_BYTES)
    return output
  }

  async readResource(
    instanceId: string,
    uri: string,
    context: McpAppRouteContext
  ): Promise<{ contents: Resource[] }> {
    const instance = this.assertLiveInstance(instanceId, context)
    const bound = await this.resolveBoundServer(instance.descriptor)
    const contents = await bound.client.readResourceContents(uri)
    await this.assertBoundServerCurrent(instance.descriptor, bound)
    assertBoundedMcpJson(contents, 'MCP App resource result', MAX_APP_ACTION_BYTES)
    return { contents }
  }

  async listResources(
    instanceId: string,
    cursor: string | undefined,
    context: McpAppRouteContext
  ): Promise<McpAppServerResourceListResult> {
    const instance = this.assertLiveInstance(instanceId, context)
    const bound = await this.resolveBoundServer(instance.descriptor)
    const result = await bound.client.listResourcesPage(cursor)
    await this.assertBoundServerCurrent(instance.descriptor, bound)
    const output: McpAppServerResourceListResult = {
      resources: result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.title ? { title: resource.title } : {}),
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
        ...(resource.size !== undefined ? { size: resource.size } : {}),
        ...(resource.icons ? { icons: resource.icons } : {}),
        ...(resource.annotations ? { annotations: resource.annotations } : {}),
        ...(resource._meta ? { _meta: resource._meta } : {})
      })),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result._meta ? { _meta: result._meta } : {})
    }
    assertBoundedMcpJson(output, 'MCP App resource list', MAX_APP_ACTION_BYTES)
    return output
  }

  async listResourceTemplates(
    instanceId: string,
    cursor: string | undefined,
    context: McpAppRouteContext
  ): Promise<McpAppServerResourceTemplateListResult> {
    const instance = this.assertLiveInstance(instanceId, context)
    const bound = await this.resolveBoundServer(instance.descriptor)
    const result = await bound.client.listResourceTemplatesPage(cursor)
    await this.assertBoundServerCurrent(instance.descriptor, bound)
    const output: McpAppServerResourceTemplateListResult = {
      resourceTemplates: result.resourceTemplates.map((template) => ({
        uriTemplate: template.uriTemplate,
        name: template.name,
        ...(template.title ? { title: template.title } : {}),
        ...(template.description ? { description: template.description } : {}),
        ...(template.mimeType ? { mimeType: template.mimeType } : {}),
        ...(template.icons ? { icons: template.icons } : {}),
        ...(template.annotations ? { annotations: template.annotations } : {}),
        ...(template._meta ? { _meta: template._meta } : {})
      })),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result._meta ? { _meta: result._meta } : {})
    }
    assertBoundedMcpJson(output, 'MCP App resource template list', MAX_APP_ACTION_BYTES)
    return output
  }

  async listPrompts(
    instanceId: string,
    cursor: string | undefined,
    context: McpAppRouteContext
  ): Promise<McpAppServerPromptListResult> {
    const instance = this.assertLiveInstance(instanceId, context)
    const bound = await this.resolveBoundServer(instance.descriptor)
    const result = await bound.client.listPromptsPage(cursor)
    await this.assertBoundServerCurrent(instance.descriptor, bound)
    const output: McpAppServerPromptListResult = {
      prompts: result.prompts.map((prompt) => ({
        name: prompt.name,
        ...(prompt.title ? { title: prompt.title } : {}),
        ...(prompt.description ? { description: prompt.description } : {}),
        ...(prompt.arguments
          ? {
              arguments: prompt.arguments.map((argument) => ({
                name: argument.name,
                ...(argument.description ? { description: argument.description } : {}),
                ...(argument.required !== undefined ? { required: argument.required } : {})
              }))
            }
          : {}),
        ...(prompt.icons ? { icons: prompt.icons } : {}),
        ...(prompt._meta ? { _meta: prompt._meta } : {})
      })),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result._meta ? { _meta: result._meta } : {})
    }
    assertBoundedMcpJson(output, 'MCP App prompt list', MAX_APP_ACTION_BYTES)
    return output
  }

  async openLink(instanceId: string, url: string, context: McpAppRouteContext): Promise<boolean> {
    const instance = this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    const normalizedUrl = normalizeExternalUrl(url)
    const approved = await this.deps.registry.requestConsent(instance, {
      kind: 'open-link',
      title: instance.descriptor.toolName,
      detail: normalizedUrl,
      url: normalizedUrl
    })
    if (!approved) {
      return false
    }
    this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    await shell.openExternal(normalizedUrl)
    return true
  }

  async authorizeMessage(
    instanceId: string,
    text: string,
    context: McpAppRouteContext
  ): Promise<boolean> {
    const instance = this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    if (!text.trim() || text.length > MAX_APP_MESSAGE_LENGTH) {
      throw new Error('MCP App message is empty or too long')
    }
    const approved = await this.deps.registry.requestConsent(instance, {
      kind: 'send-message',
      title: instance.descriptor.toolName,
      detail: text
    })
    if (approved) {
      this.assertLiveInstance(instanceId, context)
      await this.assertDescriptorCurrent(instance.descriptor)
    }
    return approved
  }

  async updateModelContext(
    instanceId: string,
    input: {
      content?: MCPContentItem[]
      structuredContent?: Record<string, unknown>
    },
    context: McpAppRouteContext
  ): Promise<{ approved: boolean; approvedHash?: string }> {
    const instance = this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    assertBoundedMcpJson(input, 'MCP App model context', MAX_APP_CONTEXT_BYTES)
    const approvedHash = createHash('sha256')
      .update(JSON.stringify(input) ?? 'null')
      .digest('hex')
    const serializedInput = JSON.stringify(input) ?? '{}'
    const consentDetail =
      serializedInput.length <= MAX_CONSENT_DETAIL_LENGTH
        ? serializedInput
        : `${serializedInput.slice(0, MAX_CONSENT_DETAIL_LENGTH - 80)}…\nSHA-256: ${approvedHash}`
    const approved = await this.deps.registry.requestConsent(instance, {
      kind: 'update-model-context',
      title: instance.descriptor.toolName,
      detail: consentDetail
    })
    if (!approved) {
      return { approved: false }
    }
    this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    if (
      !this.deps.persistModelContext(
        instance.messageId,
        instance.blockId,
        instance.descriptor,
        instance.toolInput,
        {
          ...input,
          approvedHash
        }
      )
    ) {
      throw new Error('The MCP App tool result is no longer available')
    }
    return { approved: true, approvedHash }
  }

  async retryToolAccess(instanceId: string, context: McpAppRouteContext): Promise<void> {
    const instance = this.assertLiveInstance(instanceId, context)
    await this.assertDescriptorCurrent(instance.descriptor)
    instance.toolAccessSuspended = false
  }

  async submitConsent(
    requestId: string,
    approved: boolean,
    context: McpAppRouteContext
  ): Promise<void> {
    if (!this.deps.registry.submitConsent(requestId, approved, context)) {
      throw new Error('MCP App consent request is unavailable')
    }
  }

  private async resolveBoundServer(descriptor: McpAppDescriptor): Promise<BoundServer> {
    const serverName = await this.assertDescriptorCurrent(descriptor)
    let client = this.deps.serverManager.getClient(serverName)
    if (!client?.isServerRunning()) {
      await this.deps.ensureServerRunning(serverName)
      const currentServerName = await this.assertDescriptorCurrent(descriptor)
      if (currentServerName !== serverName) {
        throw new Error('The MCP server binding changed; this saved App is inert')
      }
      client = this.deps.serverManager.getClient(serverName)
    }
    if (!client?.isServerRunning()) {
      throw new Error('The MCP server for this App is unavailable')
    }
    return { serverName, client }
  }

  private async assertDescriptorCurrent(descriptor: McpAppDescriptor): Promise<string> {
    const servers = await this.deps.settings.getMcpServers()
    const match = Object.entries(servers).find(
      ([, config]) => config.serverId === descriptor.serverId
    )
    if (!match) {
      throw new Error('The MCP server for this App no longer exists')
    }
    const [serverName, config] = match
    const isPluginOwned =
      Boolean(config.ownerPluginId) || (config.source === 'plugin' && Boolean(config.sourceId))
    if (
      (!config.enabled && !isPluginOwned) ||
      (config.configGeneration ?? 1) !== descriptor.configGeneration ||
      config.bindingHash !== descriptor.bindingHash
    ) {
      throw new Error('The MCP server binding changed; this saved App is inert')
    }
    return serverName
  }

  private async assertBoundServerCurrent(
    descriptor: McpAppDescriptor,
    bound: BoundServer
  ): Promise<void> {
    const serverName = await this.assertDescriptorCurrent(descriptor)
    if (
      serverName !== bound.serverName ||
      this.deps.serverManager.getClient(serverName) !== bound.client ||
      !bound.client.isServerRunning()
    ) {
      throw new Error('The MCP server binding changed; this saved App is inert')
    }
  }

  private assertLiveInstance(
    instanceId: string,
    context: McpAppRouteContext
  ): McpAppSandboxInstance {
    const instance = this.deps.registry.assertOwned(instanceId, context)
    if (
      !this.deps.validateSource({
        descriptor: instance.descriptor,
        conversationId: instance.conversationId,
        messageId: instance.messageId,
        blockId: instance.blockId,
        toolInput: instance.toolInput
      })
    ) {
      this.deps.registry.revoke(instanceId)
      throw new Error('The MCP App source no longer matches the saved tool result')
    }
    return instance
  }

  private isToolAllowedByPluginPolicy(serverName: string, toolName: string): boolean {
    const policy = resolvePluginToolPolicy(serverName, toolName)
    return !policy.managed || policy.decision === 'allow' || policy.decision === 'ask'
  }

  private async findListedResourceUiMeta(
    client: BoundServer['client'],
    resourceUri: string
  ): Promise<Record<string, unknown> | undefined> {
    try {
      let cursor: string | undefined
      for (let page = 0; page < MAX_RESOURCE_LIST_PAGES; page += 1) {
        const result = await client.listResourcesPage(cursor)
        const resource = result.resources.find((entry) => entry.uri === resourceUri)
        if (resource) {
          return readUiMeta(resource as Resource)
        }
        if (!result.nextCursor || result.nextCursor === cursor) {
          return undefined
        }
        cursor = result.nextCursor
      }
      return undefined
    } catch {
      return undefined
    }
  }
}
