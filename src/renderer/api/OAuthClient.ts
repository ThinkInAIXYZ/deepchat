import type { DeepchatBridge } from '@shared/contracts/bridge'
import { oauthOpenAICodexStatusChangedEvent } from '@shared/contracts/events'
import {
  oauthOpenAICodexCancelLoginRoute,
  oauthOpenAICodexGetStatusRoute,
  oauthOpenAICodexLogoutRoute,
  oauthOpenAICodexStartBrowserLoginRoute,
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  type OpenAICodexAuthStatus
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

  async function getOpenAICodexStatus(): Promise<OpenAICodexAuthStatus> {
    const result = await bridge.invoke(oauthOpenAICodexGetStatusRoute.name, {})
    return result.status
  }

  async function startOpenAICodexBrowserLogin(): Promise<OpenAICodexAuthStatus> {
    const result = await bridge.invoke(oauthOpenAICodexStartBrowserLoginRoute.name, {})
    return result.status
  }

  async function cancelOpenAICodexLogin(): Promise<OpenAICodexAuthStatus> {
    const result = await bridge.invoke(oauthOpenAICodexCancelLoginRoute.name, {})
    return result.status
  }

  async function logoutOpenAICodex(): Promise<OpenAICodexAuthStatus> {
    const result = await bridge.invoke(oauthOpenAICodexLogoutRoute.name, {})
    return result.status
  }

  function onOpenAICodexStatusChanged(
    listener: (status: OpenAICodexAuthStatus) => void
  ): () => void {
    return bridge.on(oauthOpenAICodexStatusChangedEvent.name, (payload) => {
      listener(payload.status)
    })
  }

  return {
    startGitHubCopilotLogin,
    startGitHubCopilotDeviceFlowLogin,
    getOpenAICodexStatus,
    startOpenAICodexBrowserLogin,
    cancelOpenAICodexLogin,
    logoutOpenAICodex,
    onOpenAICodexStatusChanged
  }
}

export type OAuthClient = ReturnType<typeof createOAuthClient>
