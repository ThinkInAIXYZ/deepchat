import * as fs from 'node:fs'
import path from 'node:path'
import {
  CLI_COMMAND_DEFINITIONS,
  cliCommandKey,
  getAgentCliCommandContract
} from '@shared/contracts/cliCommands'
import {
  LOCAL_CONTROL_AGENT_TOKEN_ENV,
  type LocalControlScope
} from '@shared/contracts/localControl'
import type { CommandPermissionService } from '@/tool/permission/commandPermissionService'
import type { AgentCliTokenAuthority } from './agentTokenAuthority'
import { getCliSurfaceEntry } from './surface'
import type { ResolvedCommandShell } from '@shared/commandShell'

const AGENT_CLI_COMMAND_PATTERN = /^deepchat\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9-]*)(?:\s|$)/
const AGENT_CLI_COMMAND_TOKEN_TTL_MS = 5 * 60_000

function referencesAgentToken(command: string, commandShell: ResolvedCommandShell): boolean {
  return commandShell.dialect === 'posix'
    ? command.includes(LOCAL_CONTROL_AGENT_TOKEN_ENV)
    : command.toUpperCase().includes(LOCAL_CONTROL_AGENT_TOKEN_ENV)
}

export type AgentCommandEnvironment = Readonly<{
  variables: Readonly<Record<string, string>>
  prependPath: readonly string[]
  preserveCommand: boolean
}>

export type AgentCliCommandAccessOptions = Readonly<{
  tokenAuthority: Pick<AgentCliTokenAuthority, 'issue'>
  commandPermission: Pick<CommandPermissionService, 'extractBaseCommand' | 'hasShellControlSyntax'>
  resolveCliDirectory(): string | null
}>

type AgentCliCommandCapability = Readonly<{
  scopes: readonly LocalControlScope[]
}>

function createAgentCliCommandRegistry(): ReadonlyMap<string, AgentCliCommandCapability> {
  const registry = new Map<string, AgentCliCommandCapability>()
  for (const definition of CLI_COMMAND_DEFINITIONS) {
    const contract = getAgentCliCommandContract(definition)
    if (!contract) continue
    const surface = getCliSurfaceEntry(contract.name)
    if (!surface || !surface.callers.includes('agent') || surface.scopes.length === 0) {
      throw new Error(
        `Agent CLI command is not backed by an Agent-accessible surface: ${definition.domain} ${definition.verb}`
      )
    }
    registry.set(cliCommandKey(definition.domain, definition.verb), { scopes: surface.scopes })
  }
  return registry
}

const AGENT_CLI_COMMANDS = createAgentCliCommandRegistry()

function unprivilegedAgentEnvironment(preserveCommand = false): AgentCommandEnvironment {
  return {
    variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
    prependPath: [],
    preserveCommand
  }
}

function localAgentEnvironment(cliDirectory: string | null): AgentCommandEnvironment {
  return {
    variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
    prependPath: cliDirectory ? [cliDirectory] : [],
    preserveCommand: true
  }
}

export function resolveBundledCliDirectory(
  input: Readonly<{
    appPath: string
    resourcesPath: string
    isPackaged: boolean
    platform?: NodeJS.Platform
    isFile?: (filePath: string) => boolean
  }>
): string | null {
  const platform = input.platform ?? process.platform
  const directory = input.isPackaged
    ? path.join(input.resourcesPath, 'app.asar.unpacked', 'cli')
    : path.join(input.appPath, 'out', 'cli')
  const launcher = path.join(directory, platform === 'win32' ? 'deepchat.cmd' : 'deepchat')
  if (input.isFile) return input.isFile(launcher) ? directory : null
  try {
    return fs.statSync(launcher).isFile() ? directory : null
  } catch {
    return null
  }
}

export class AgentCliCommandAccess {
  constructor(private readonly options: AgentCliCommandAccessOptions) {}

  createEnvironment(
    conversationId: string,
    command: string,
    commandShell: ResolvedCommandShell
  ): AgentCommandEnvironment | undefined {
    const normalizedConversationId = conversationId.trim()
    const normalizedCommand = command.trim()
    if (!normalizedConversationId) return undefined
    if (this.options.commandPermission.extractBaseCommand(normalizedCommand) !== 'deepchat') {
      return unprivilegedAgentEnvironment()
    }
    if (normalizedCommand === 'deepchat help') {
      return localAgentEnvironment(this.options.resolveCliDirectory())
    }

    const commandMatch = AGENT_CLI_COMMAND_PATTERN.exec(normalizedCommand)
    if (
      this.options.commandPermission.hasShellControlSyntax(
        normalizedCommand,
        commandShell.dialect
      ) ||
      !commandMatch ||
      referencesAgentToken(normalizedCommand, commandShell)
    ) {
      return unprivilegedAgentEnvironment(true)
    }

    const capability = AGENT_CLI_COMMANDS.get(cliCommandKey(commandMatch[1], commandMatch[2]))
    if (!capability) return unprivilegedAgentEnvironment(true)
    const cliDirectory = this.options.resolveCliDirectory()
    if (!cliDirectory) return unprivilegedAgentEnvironment(true)
    const issued = this.options.tokenAuthority.issue({
      conversationId: normalizedConversationId,
      scopes: capability.scopes,
      ttlMs: AGENT_CLI_COMMAND_TOKEN_TTL_MS,
      maxCalls: 1
    })
    return {
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: issued.token },
      prependPath: [cliDirectory],
      preserveCommand: true
    }
  }
}
