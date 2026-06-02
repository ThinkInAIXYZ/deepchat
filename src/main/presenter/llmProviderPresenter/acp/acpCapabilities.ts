import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'

export interface AcpCapabilityOptions {
  enableFs?: boolean
  enableTerminal?: boolean
  enableTerminalAuth?: boolean
}

export interface AcpCapabilitySupport {
  loadSession: boolean
  sessionList: boolean
  sessionResume: boolean
  sessionClose: boolean
  sessionFork: boolean
}

export interface AcpCapabilitySnapshot {
  protocolVersion?: schema.ProtocolVersion
  agentInfo?: schema.Implementation | null
  agentCapabilities?: schema.AgentCapabilities
  sessionCapabilities?: schema.SessionCapabilities
  promptCapabilities?: schema.PromptCapabilities
  authMethods: schema.AuthMethod[]
  mcpCapabilities?: schema.McpCapabilities
  supports: AcpCapabilitySupport
}

export function buildCapabilitySnapshot(
  initializeResult: schema.InitializeResponse
): AcpCapabilitySnapshot {
  const agentCapabilities = initializeResult.agentCapabilities
  const sessionCapabilities = agentCapabilities?.sessionCapabilities

  return {
    protocolVersion: initializeResult.protocolVersion,
    agentInfo: initializeResult.agentInfo,
    agentCapabilities,
    sessionCapabilities,
    promptCapabilities: agentCapabilities?.promptCapabilities,
    authMethods: initializeResult.authMethods ?? [],
    mcpCapabilities: agentCapabilities?.mcpCapabilities,
    supports: {
      loadSession: Boolean(agentCapabilities?.loadSession),
      sessionList: Boolean(sessionCapabilities?.list),
      sessionResume: Boolean(sessionCapabilities?.resume),
      sessionClose: Boolean(sessionCapabilities?.close),
      sessionFork: Boolean(sessionCapabilities?.fork)
    }
  }
}

/**
 * Build client capabilities object for ACP initialization.
 *
 * This determines what features the client (DeepChat) advertises to the agent.
 * Agents use these capabilities to decide which operations to request.
 */
export function buildClientCapabilities(
  options: AcpCapabilityOptions = {}
): schema.ClientCapabilities {
  const caps: schema.ClientCapabilities = {}

  if (options.enableFs !== false) {
    caps.fs = {
      readTextFile: true,
      writeTextFile: true
    }
  }

  if (options.enableTerminal !== false) {
    caps.terminal = true
  }

  if (options.enableTerminal !== false && options.enableTerminalAuth) {
    caps.auth = {
      terminal: true
    }
  }

  return caps
}
