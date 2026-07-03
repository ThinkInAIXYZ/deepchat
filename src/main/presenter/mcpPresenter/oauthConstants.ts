function getPortEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : fallback
}

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const MCP_OAUTH_REDIRECT_PORT = getPortEnv('DEEPCHAT_MCP_OAUTH_REDIRECT_PORT', 1456)
export const MCP_OAUTH_REDIRECT_PATH = '/mcp/oauth/callback'
export const MCP_OAUTH_CALLBACK_TIMEOUT_MS = getNumberEnv(
  'DEEPCHAT_MCP_OAUTH_CALLBACK_TIMEOUT_MS',
  10 * 60 * 1000
)
