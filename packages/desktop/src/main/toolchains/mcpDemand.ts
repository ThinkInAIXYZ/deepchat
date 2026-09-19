import type { MCPServerConfig } from '@shared/types/mcp'
import type { ToolchainKind } from '@shared/types/toolchains'

const NODE_TOOLCHAIN_COMMANDS = new Set(['node', 'npm', 'npx', 'corepack'])
const UV_TOOLCHAIN_COMMANDS = new Set(['uv', 'uvx'])

function mcpServerIsDemandCandidate(
  config: Pick<MCPServerConfig, 'command' | 'type' | 'source' | 'ownerPluginId' | 'enabled'>
): boolean {
  if (config.enabled === false) return false
  if (config.source === 'plugin' || config.ownerPluginId) return false
  if (config.type && config.type !== 'stdio') return false
  if (typeof config.command !== 'string') return false
  return true
}

export function mcpServerNeedsNode(
  config: Pick<MCPServerConfig, 'command' | 'type' | 'source' | 'ownerPluginId' | 'enabled'>,
  platform: NodeJS.Platform = process.platform
): boolean {
  return (
    mcpServerIsDemandCandidate(config) &&
    NODE_TOOLCHAIN_COMMANDS.has(commandBasename(config.command, platform))
  )
}

export function mcpServerNeedsUv(
  config: Pick<MCPServerConfig, 'command' | 'type' | 'source' | 'ownerPluginId' | 'enabled'>,
  platform: NodeJS.Platform = process.platform
): boolean {
  return (
    mcpServerIsDemandCandidate(config) &&
    UV_TOOLCHAIN_COMMANDS.has(commandBasename(config.command, platform))
  )
}

export async function noteNodeDemandFromMcp(
  settings: {
    getMcpEnabled(): Promise<boolean>
    getEnabledMcpServers(): Promise<string[]>
    getMcpServers(): Promise<Record<string, MCPServerConfig>>
  },
  toolchains: { noteDemand(kind: ToolchainKind): void }
): Promise<void> {
  if (!(await settings.getMcpEnabled())) return
  const [enabled, servers] = await Promise.all([
    settings.getEnabledMcpServers(),
    settings.getMcpServers()
  ])
  let notedNode = false
  let notedUv = false
  for (const name of enabled) {
    const config = servers[name]
    if (!config) continue
    if (!notedNode && mcpServerNeedsNode(config)) {
      toolchains.noteDemand('node')
      notedNode = true
    }
    if (!notedUv && mcpServerNeedsUv(config)) {
      toolchains.noteDemand('uv')
      notedUv = true
    }
    if (notedNode && notedUv) return
  }
}

function commandBasename(command: string, platform: NodeJS.Platform): string {
  const trimmed = command.trim()
  const parts = trimmed.split(platform === 'win32' ? /[\\/]/ : '/')
  const basename = parts.at(-1) ?? ''
  if (!basename) return ''
  return platform === 'win32' ? basename.toLowerCase().replace(/\.(exe|cmd|bat)$/i, '') : basename
}
