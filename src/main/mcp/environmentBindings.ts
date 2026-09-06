/** Resolve only explicitly named bindings. Values remain outside persisted configuration. */
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
