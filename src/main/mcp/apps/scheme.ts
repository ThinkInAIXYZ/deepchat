/**
 * The custom scheme MCP app sandboxes are served from.
 *
 * Kept apart from `sandboxRegistry`, which registers the scheme through
 * Electron's `session`, so readers that only need the name do not pull that in.
 */
export const MCP_APP_SCHEME = 'mcp-app'
