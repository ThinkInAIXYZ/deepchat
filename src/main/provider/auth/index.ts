import { createGitHubCopilotOAuth } from './githubCopilotOAuth'
import { getGlobalGitHubCopilotDeviceFlow } from './githubCopilotDeviceFlow'
import type { GitHubCopilotAuthorizationPort } from '../../../harness/core/oauth'

export function createGitHubCopilotAuthorization(): GitHubCopilotAuthorizationPort {
  // shortcut: Complete physical Copilot-window cancellation before G5 default adoption.
  return {
    browser: async (clientId, signal) => {
      signal.throwIfAborted()
      const oauth = createGitHubCopilotOAuth(clientId)
      const code = await oauth.startLogin()
      signal.throwIfAborted()
      if (!code) throw new Error('Failed to obtain authorization code')
      const token = await oauth.exchangeCodeForToken(code)
      signal.throwIfAborted()
      return token
    },
    device: async (clientId, signal) => {
      signal.throwIfAborted()
      const token = await getGlobalGitHubCopilotDeviceFlow(clientId).startDeviceFlow()
      signal.throwIfAborted()
      return token
    }
  }
}
