import type * as schema from '@agentclientprotocol/sdk'
import type { LodyExtensionCapabilities } from 'acp-extension-core'
import { readLodyCapabilities } from './acpLodyExtensions'

export interface AcpCapabilityOptions {
  enableFs?: boolean
  enableTerminal?: boolean
  enableTerminalAuth?: boolean
  enableElicitation?: boolean
  enablePlans?: boolean
  enableSubagentEvents?: boolean
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
  extensions: LodyExtensionCapabilities
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
    extensions: readLodyCapabilities(agentCapabilities?._meta),
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

  if (options.enablePlans) caps.plan = {}
  if (options.enableElicitation) caps.elicitation = { form: {}, url: {} }
  if (options.enableElicitation || options.enableSubagentEvents) {
    caps._meta = {
      lody: {
        ...(options.enableElicitation ? { elicitation: { version: 1, answerNotes: true } } : {}),
        ...(options.enableSubagentEvents ? { subagentEvents: { version: 1 } } : {})
      }
    }
  }

  return caps
}
