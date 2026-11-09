import path from 'node:path'
import type { MCPServerConfig } from '@shared/types/mcp'
import type { DimMcpServer } from '@/agent/dim/mcp'
import { resolveMcpEnvironmentBinding } from './environmentBindings'

interface StdioOptions {
  home: string
  paths: string[]
  expand(value: string): string
  rewrite(command: string, args: string[]): { command: string; args: string[] }
  npmRegistry?: string | null
  uvRegistry?: string | null
}

/** Packaging and explicit variable bindings only. dim starts and owns the MCP process. */
export function nativeMcpStdio(
  config: MCPServerConfig,
  options: StdioOptions
): DimMcpServer | null {
  // The pinned public native transport cannot set CWD or clear inherited variables. Retain the
  // product-managed transport for those explicit settings, rather than silently ignoring them.
  if (config.cwd || config.inheritEnv === 'minimal') return null
  const resolve = (value: string) =>
    options.expand(resolveMcpEnvironmentBinding(value, config.environmentVariables))
  const command = options.rewrite(resolve(config.command ?? ''), (config.args ?? []).map(resolve))
  if (!command.command) throw new Error('MCP stdio command is empty')
  const env: Record<string, string> = {
    HOME: options.home,
    USERPROFILE: options.home,
    PATH: [...options.paths, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter)
  }
  for (const [name, value] of Object.entries(config.env ?? {})) {
    const resolved = resolveMcpEnvironmentBinding(String(value), config.environmentVariables)
    if (name.toLowerCase() === 'path') env.PATH = resolved + path.delimiter + env.PATH
    else env[name] = resolved
  }
  if (options.npmRegistry) env.npm_config_registry = options.npmRegistry
  if (options.uvRegistry) {
    env.UV_DEFAULT_INDEX = options.uvRegistry
    env.PIP_INDEX_URL = options.uvRegistry
  }
  return { type: 'stdio', ...command, env }
}
