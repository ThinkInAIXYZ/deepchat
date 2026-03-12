import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

export interface AcpCapabilityOptions {
  enableFs?: boolean
  enableTerminal?: boolean
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

  return caps
}
