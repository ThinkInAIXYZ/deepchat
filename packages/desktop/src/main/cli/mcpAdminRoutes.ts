import path from 'node:path'
import {
  PUBLIC_MCP_LIST_MAX_ITEMS,
  PublicMcpServerNameSchema,
  PublicMcpServerSchema,
  mcpAddPublicRoute,
  mcpListPublicRoute,
  mcpRemovePublicRoute,
  mcpSetPublicStatusRoute,
  mcpStartPublicRoute,
  mcpStopPublicRoute,
  mcpUpdatePublicRoute,
  type PublicMcpServer,
  type PublicMcpServerConfigInput,
  type PublicMcpServerUpdate,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { MCPServerConfig, McpServicePort } from '@shared/types/mcp'
import {
  createRouteMap,
  type CliRouteCaller,
  type DeepchatRouteMap,
  type RouteCaller
} from '@/routes/routeRegistry'
import { CliRequestError } from './errors'
import { compareStableText, sanitizePublicText } from './publicText'

const PUBLIC_MCP_DESCRIPTION_BYTES = 1024
const PUBLIC_MCP_COMMAND_NAME_BYTES = 256

type PublicMcpPort = Pick<
  McpServicePort,
  | 'addMcpServer'
  | 'getMcpServers'
  | 'isServerRunning'
  | 'removeMcpServer'
  | 'setMcpServerEnabled'
  | 'startServer'
  | 'stopServer'
  | 'updateMcpServer'
>

export type CliMcpAdminDependencies = Readonly<{
  mcp: PublicMcpPort
  recordSettingsActivity?(input: SettingsActivityInput): void
  log?: Pick<Console, 'warn'>
}>

function requireCliCaller(caller: RouteCaller): asserts caller is CliRouteCaller {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'MCP administration requires a CLI caller', {
      httpStatus: 403
    })
  }
}

function requireHumanCliCaller(
  caller: RouteCaller
): asserts caller is CliRouteCaller & { principal: 'human' } {
  requireCliCaller(caller)
  if (caller.principal !== 'human') {
    throw new CliRequestError(
      'permission_denied',
      'MCP administration requires a human CLI caller',
      {
        httpStatus: 403
      }
    )
  }
}

function isPluginOwned(config: MCPServerConfig): boolean {
  return Boolean(config.ownerPluginId || config.source === 'plugin')
}

function boundedCount(value: number): Readonly<{ value: number; truncated: boolean }> {
  return {
    value: Math.min(value, 1_000_000),
    truncated: value > 1_000_000
  }
}

function commandBasename(command: string): string {
  return path.posix.basename(path.win32.basename(command))
}

function endpointSummary(baseUrl: string | undefined): {
  value: PublicMcpServer['endpoint']
  truncated: boolean
} {
  if (!baseUrl) return { value: null, truncated: false }
  try {
    const url = new URL(baseUrl)
    return {
      value: {
        origin: url.origin,
        pathPresent: url.pathname !== '/' || Boolean(url.search)
      },
      truncated: false
    }
  } catch {
    return { value: null, truncated: true }
  }
}

function toPublicMcpServer(
  serverName: string,
  config: MCPServerConfig,
  running: boolean | null
): PublicMcpServer | null {
  const parsedName = PublicMcpServerNameSchema.safeParse(serverName)
  if (!parsedName.success) return null

  const description = sanitizePublicText(config.descriptions, PUBLIC_MCP_DESCRIPTION_BYTES)
  const rawCommandName =
    config.type === 'stdio' && typeof config.command === 'string'
      ? commandBasename(config.command)
      : ''
  const commandName = rawCommandName
    ? sanitizePublicText(rawCommandName, PUBLIC_MCP_COMMAND_NAME_BYTES)
    : { value: '', truncated: false }
  const endpoint = endpointSummary(config.baseUrl)
  const argumentCount = boundedCount(Array.isArray(config.args) ? config.args.length : 0)
  const environmentEntryCount = boundedCount(
    config.env && typeof config.env === 'object' ? Object.keys(config.env).length : 0
  )
  const headerEntryCount = boundedCount(
    config.customHeaders && typeof config.customHeaders === 'object'
      ? Object.keys(config.customHeaders).length
      : 0
  )
  const pluginOwned = isPluginOwned(config)

  const parsed = PublicMcpServerSchema.safeParse({
    name: parsedName.data,
    type: config.type,
    enabled: config.enabled,
    running,
    managedBy: pluginOwned ? 'plugin' : config.type === 'inmemory' ? 'deepchat' : 'user',
    editable: !pluginOwned && config.type !== 'inmemory',
    removable: !pluginOwned && config.type !== 'inmemory',
    description: description.value,
    commandName: commandName.value || null,
    endpoint: endpoint.value,
    argumentCount: argumentCount.value,
    environmentEntryCount: environmentEntryCount.value,
    headerEntryCount: headerEntryCount.value,
    authorizationMode: config.authorization?.mode ?? null,
    metadataTruncated:
      description.truncated ||
      commandName.truncated ||
      endpoint.truncated ||
      argumentCount.truncated ||
      environmentEntryCount.truncated ||
      headerEntryCount.truncated
  })
  return parsed.success ? parsed.data : null
}

function toStoredConfig(input: PublicMcpServerConfigInput): MCPServerConfig {
  const common = {
    descriptions: input.description,
    icons: input.icon,
    enabled: false,
    type: input.type
  } as const
  if (input.type === 'stdio') {
    return {
      ...common,
      command: input.command,
      args: input.args,
      env: input.environment,
      inheritEnv: input.inheritEnv,
      ...(input.customNpmRegistry ? { customNpmRegistry: input.customNpmRegistry } : {})
    }
  }
  return {
    ...common,
    command: '',
    args: [],
    env: {},
    baseUrl: input.baseUrl,
    customHeaders: input.headers,
    ...(input.type === 'http' && input.authorization ? { authorization: input.authorization } : {})
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function toStoredUpdate(
  current: MCPServerConfig,
  updates: PublicMcpServerUpdate
): Partial<MCPServerConfig> {
  const targetType = updates.type ?? current.type
  if (targetType === 'inmemory') {
    throw new CliRequestError(
      'conflict',
      'In-memory MCP servers cannot be edited through the CLI',
      {
        httpStatus: 409
      }
    )
  }

  const stdioOnlyFields = ['command', 'args', 'environment', 'inheritEnv', 'customNpmRegistry']
  const remoteOnlyFields = ['baseUrl', 'headers', 'authorization']
  const invalidField = (targetType === 'stdio' ? remoteOnlyFields : stdioOnlyFields).find((field) =>
    hasOwn(updates, field)
  )
  if (invalidField) {
    throw new CliRequestError(
      'invalid_request',
      `${invalidField} is not valid for MCP transport ${targetType}`
    )
  }
  if (targetType === 'sse' && hasOwn(updates, 'authorization')) {
    throw new CliRequestError('invalid_request', 'authorization is only valid for HTTP MCP servers')
  }

  const typeChanged = targetType !== current.type
  if (typeChanged && targetType === 'stdio' && updates.command === undefined) {
    throw new CliRequestError('invalid_request', 'Changing an MCP server to stdio requires command')
  }
  if (typeChanged && targetType !== 'stdio' && updates.baseUrl === undefined) {
    throw new CliRequestError(
      'invalid_request',
      'Changing an MCP server to a remote transport requires baseUrl'
    )
  }

  const stored: Partial<MCPServerConfig> = {
    ...(updates.description !== undefined ? { descriptions: updates.description } : {}),
    ...(updates.icon !== undefined ? { icons: updates.icon } : {})
  }
  if (typeChanged) {
    stored.type = targetType
    if (targetType === 'stdio') {
      stored.command = updates.command!
      stored.args = updates.args ?? []
      stored.env = updates.environment ?? {}
      stored.inheritEnv = updates.inheritEnv ?? 'minimal'
      stored.customNpmRegistry = updates.customNpmRegistry ?? undefined
      stored.baseUrl = undefined
      stored.customHeaders = undefined
      stored.authorization = undefined
    } else {
      stored.command = ''
      stored.args = []
      stored.env = {}
      stored.inheritEnv = undefined
      stored.customNpmRegistry = undefined
      stored.baseUrl = updates.baseUrl!
      stored.customHeaders = updates.headers ?? {}
      stored.authorization = updates.authorization ?? undefined
    }
    return stored
  }

  if (updates.command !== undefined) stored.command = updates.command
  if (updates.args !== undefined) stored.args = updates.args
  if (updates.environment !== undefined) stored.env = updates.environment
  if (updates.inheritEnv !== undefined) stored.inheritEnv = updates.inheritEnv
  if (hasOwn(updates, 'customNpmRegistry')) {
    stored.customNpmRegistry = updates.customNpmRegistry ?? undefined
  }
  if (updates.baseUrl !== undefined) stored.baseUrl = updates.baseUrl
  if (updates.headers !== undefined) stored.customHeaders = updates.headers
  if (hasOwn(updates, 'authorization')) {
    stored.authorization = updates.authorization ?? undefined
  }
  return stored
}

export function createCliMcpAdminRoutes(dependencies: CliMcpAdminDependencies): DeepchatRouteMap {
  const log = dependencies.log ?? console
  const unavailable = (action: string, error: unknown): CliRequestError => {
    log.warn(`[CLI] Failed to ${action}`, {
      failure: { name: error instanceof Error ? error.name : typeof error }
    })
    return new CliRequestError('unavailable', `Could not ${action}`, {
      httpStatus: 503,
      retriable: true
    })
  }
  const loadServers = async (): Promise<Record<string, MCPServerConfig>> => {
    try {
      return await dependencies.mcp.getMcpServers()
    } catch (error) {
      throw unavailable('read MCP servers', error)
    }
  }
  const requireUserServer = async (
    serverName: string
  ): Promise<Readonly<{ config: MCPServerConfig }>> => {
    const config = (await loadServers())[serverName]
    if (!config) {
      throw new CliRequestError('not_found', 'MCP server was not found', { httpStatus: 404 })
    }
    if (isPluginOwned(config)) {
      throw new CliRequestError('conflict', 'Plugin-owned MCP server cannot be edited', {
        httpStatus: 409
      })
    }
    if (config.type === 'inmemory') {
      throw new CliRequestError('conflict', 'In-memory MCP server cannot be edited', {
        httpStatus: 409
      })
    }
    if (config.type !== 'stdio' && config.type !== 'sse' && config.type !== 'http') {
      throw new CliRequestError('conflict', 'MCP server uses an unsupported transport', {
        httpStatus: 409
      })
    }
    return { config }
  }
  const readRunning = async (serverName: string): Promise<boolean | null> => {
    try {
      return await dependencies.mcp.isServerRunning(serverName)
    } catch {
      return null
    }
  }
  const summarizeServer = async (
    serverName: string,
    config: MCPServerConfig
  ): Promise<PublicMcpServer> => {
    const server = toPublicMcpServer(serverName, config, await readRunning(serverName))
    if (!server) {
      throw new CliRequestError('internal_error', 'MCP server has invalid public metadata', {
        httpStatus: 500
      })
    }
    return server
  }
  const summarizeAppliedServer = async (serverName: string): Promise<PublicMcpServer> => {
    try {
      const config = (await dependencies.mcp.getMcpServers())[serverName]
      if (!config) throw new Error('Persisted MCP server is missing after mutation')
      return await summarizeServer(serverName, config)
    } catch (error) {
      log.warn('[CLI] Could not confirm MCP state after a successful mutation', {
        serverName,
        failure: { name: error instanceof Error ? error.name : typeof error }
      })
      throw new CliRequestError(
        'unavailable',
        'MCP mutation completed, but persisted state could not be confirmed',
        {
          httpStatus: 503,
          retriable: false,
          details: { serverName, applied: true }
        }
      )
    }
  }
  const recordActivity = (
    action: SettingsActivityInput['action'],
    serverName: string,
    summaryKey: string
  ): void => {
    try {
      dependencies.recordSettingsActivity?.({
        category: 'mcp',
        action,
        targetType: 'mcp-server',
        targetId: serverName,
        targetLabel: serverName,
        routeName: 'settings-mcp',
        summaryKey,
        summaryParams: { name: serverName }
      })
    } catch (error) {
      log.warn('[CLI] Failed to record MCP activity', {
        failure: { name: error instanceof Error ? error.name : typeof error }
      })
    }
  }

  return createRouteMap([
    [
      mcpListPublicRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        mcpListPublicRoute.input.parse(rawInput)
        const entries = Object.entries(await loadServers())
        const selected = entries
          .filter(([serverName]) => PublicMcpServerNameSchema.safeParse(serverName).success)
          .sort(([left], [right]) => compareStableText(left, right))
          .slice(0, PUBLIC_MCP_LIST_MAX_ITEMS)
        const servers = await Promise.all(
          selected.map(async ([serverName, config]) => {
            return toPublicMcpServer(serverName, config, await readRunning(serverName))
          })
        )
        const publicServers = servers.filter((server): server is PublicMcpServer => server !== null)
        return mcpListPublicRoute.output.parse({
          servers: publicServers,
          truncated: entries.length > publicServers.length
        })
      }
    ],
    [
      mcpAddPublicRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = mcpAddPublicRoute.input.parse(rawInput)
        const storedConfig = toStoredConfig(input.config)
        let result: Awaited<ReturnType<PublicMcpPort['addMcpServer']>>
        try {
          result = await dependencies.mcp.addMcpServer(input.serverName, storedConfig)
        } catch (error) {
          throw unavailable('add the MCP server', error)
        }
        if (result.status === 'duplicate') {
          throw new CliRequestError('conflict', 'MCP server name is already in use', {
            httpStatus: 409
          })
        }
        recordActivity(
          'created',
          input.serverName,
          'settings.controlCenter.activity.mcpServerCreated'
        )
        return mcpAddPublicRoute.output.parse({
          server: await summarizeAppliedServer(input.serverName)
        })
      }
    ],
    [
      mcpUpdatePublicRoute.name,
      async (rawInput, context) => {
        requireHumanCliCaller(context.caller)
        const input = mcpUpdatePublicRoute.input.parse(rawInput)
        const current = await requireUserServer(input.serverName)
        const storedUpdate = toStoredUpdate(current.config, input.updates)
        try {
          await dependencies.mcp.updateMcpServer(input.serverName, storedUpdate)
        } catch (error) {
          throw unavailable('update the MCP server', error)
        }
        recordActivity(
          'updated',
          input.serverName,
          'settings.controlCenter.activity.mcpServerUpdated'
        )
        return mcpUpdatePublicRoute.output.parse({
          server: await summarizeAppliedServer(input.serverName)
        })
      }
    ],
    [
      mcpSetPublicStatusRoute.name,
      async (rawInput, context) => {
        requireHumanCliCaller(context.caller)
        const input = mcpSetPublicStatusRoute.input.parse(rawInput)
        const current = await requireUserServer(input.serverName)
        try {
          await dependencies.mcp.setMcpServerEnabled(input.serverName, input.enabled)
        } catch (error) {
          let persisted: MCPServerConfig | undefined
          try {
            persisted = (await dependencies.mcp.getMcpServers())[input.serverName]
          } catch {
            persisted = undefined
          }
          const running = await readRunning(input.serverName)
          if (persisted?.enabled === input.enabled && current.config.enabled !== input.enabled) {
            recordActivity(
              input.enabled ? 'enabled' : 'disabled',
              input.serverName,
              'settings.controlCenter.activity.mcpServerStatusChanged'
            )
          }
          log.warn('[CLI] MCP enablement changed incompletely', {
            serverName: input.serverName,
            enabled: persisted?.enabled ?? null,
            running,
            failure: { name: error instanceof Error ? error.name : typeof error }
          })
          throw new CliRequestError(
            'unavailable',
            'MCP runtime transition failed; inspect the reported persisted state',
            {
              httpStatus: 503,
              retriable: true,
              details: {
                serverName: input.serverName,
                enabled: persisted?.enabled ?? null,
                running
              }
            }
          )
        }
        recordActivity(
          input.enabled ? 'enabled' : 'disabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStatusChanged'
        )
        return mcpSetPublicStatusRoute.output.parse({
          server: await summarizeAppliedServer(input.serverName)
        })
      }
    ],
    [
      mcpStartPublicRoute.name,
      async (rawInput, context) => {
        requireHumanCliCaller(context.caller)
        const input = mcpStartPublicRoute.input.parse(rawInput)
        const current = await requireUserServer(input.serverName)
        try {
          await dependencies.mcp.startServer(input.serverName)
        } catch (error) {
          throw unavailable('start the MCP server', error)
        }
        recordActivity(
          'enabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStarted'
        )
        return mcpStartPublicRoute.output.parse({
          server: await summarizeServer(input.serverName, current.config)
        })
      }
    ],
    [
      mcpStopPublicRoute.name,
      async (rawInput, context) => {
        requireHumanCliCaller(context.caller)
        const input = mcpStopPublicRoute.input.parse(rawInput)
        const current = await requireUserServer(input.serverName)
        try {
          await dependencies.mcp.stopServer(input.serverName)
        } catch (error) {
          throw unavailable('stop the MCP server', error)
        }
        recordActivity(
          'disabled',
          input.serverName,
          'settings.controlCenter.activity.mcpServerStopped'
        )
        return mcpStopPublicRoute.output.parse({
          server: await summarizeServer(input.serverName, current.config)
        })
      }
    ],
    [
      mcpRemovePublicRoute.name,
      async (rawInput, context) => {
        requireHumanCliCaller(context.caller)
        const input = mcpRemovePublicRoute.input.parse(rawInput)
        await requireUserServer(input.serverName)
        try {
          await dependencies.mcp.removeMcpServer(input.serverName)
        } catch (error) {
          throw unavailable('remove the MCP server', error)
        }
        recordActivity(
          'removed',
          input.serverName,
          'settings.controlCenter.activity.mcpServerRemoved'
        )
        return mcpRemovePublicRoute.output.parse({
          serverName: input.serverName,
          removed: true
        })
      }
    ]
  ])
}
