import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createOAuthClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function startGitHubCopilotLogin(providerId: string): Promise<boolean> {
    const result = await bridge.invoke(oauthGithubCopilotStartLoginRoute.name, { providerId })
    return result.success
  }

  async function startGitHubCopilotDeviceFlowLogin(providerId: string): Promise<boolean> {
    const result = await bridge.invoke(oauthGithubCopilotStartDeviceFlowLoginRoute.name, {
      providerId
    })
    return result.success
  }

  return {
    startGitHubCopilotLogin,
    startGitHubCopilotDeviceFlowLogin
  }
}

export type OAuthClient = ReturnType<typeof createOAuthClient>
