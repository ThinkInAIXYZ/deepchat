import { createGitHubCopilotOAuth } from './githubCopilotOAuth'
import { createGitHubCopilotDeviceFlow } from './githubCopilotDeviceFlow'
import type { GitHubCopilotAuthorizationPort } from '../../../harness/core/oauth'

export function createGitHubCopilotAuthorization(): GitHubCopilotAuthorizationPort {
  return {
    browser: async (clientId, signal) => {
      signal.throwIfAborted()
      const oauth = createGitHubCopilotOAuth(clientId)
      const code = await oauth.startLogin(signal)
      signal.throwIfAborted()
      if (!code) throw new Error('Failed to obtain authorization code')
      const token = await oauth.exchangeCodeForToken(code, signal)
      signal.throwIfAborted()
      return token
    },
    device: async (clientId, signal) => {
      signal.throwIfAborted()
      const token = await createGitHubCopilotDeviceFlow(clientId).startDeviceFlow(signal)
      signal.throwIfAborted()
      return token
    }
  }
}
