/** Resolve only explicitly named bindings. Values remain outside persisted configuration. */
import { createHash } from 'node:crypto'
import type { MCPServerConfig } from '@shared/types/mcp'

export function resolveMcpEnvironmentBinding(
  value: string,
  variables: unknown,
  environment: NodeJS.ProcessEnv = process.env
): string {
  if (!Array.isArray(variables)) return value
  const allowed = new Set(variables.filter((item): item is string => typeof item === 'string'))
  return value.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    if (!allowed.has(name)) return match
    const resolved = environment[name]
    if (!resolved) throw new Error(`MCP configuration requires environment variable ${name}`)
    return resolved
  })
}
export function mcpVariableBindingScope(config: Partial<MCPServerConfig>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        config.ownerPluginId,
        config.type,
        config.baseUrl,
        config.command,
        config.args,
        config.cwd,
        config.env,
        config.customHeaders,
        config.environmentVariables
      ])
    )
    .digest('hex')
}
