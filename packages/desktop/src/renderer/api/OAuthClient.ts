import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  oauthOpenAICodexStatusChangedEvent,
  oauthXaiGrokStatusChangedEvent
} from '@shared/contracts/events'
import {
  oauthOpenAICodexCancelLoginRoute,
  oauthOpenAICodexCompleteBrowserLoginFromUrlRoute,
  oauthOpenAICodexGetStatusRoute,
  oauthOpenAICodexLogoutRoute,
  oauthOpenAICodexStartBrowserLoginRoute,
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  oauthXaiGrokCancelLoginRoute,
  oauthXaiGrokGetStatusRoute,
  oauthXaiGrokLogoutRoute,
  oauthXaiGrokStartDeviceLoginRoute,
  type OpenAICodexAuthStatus,
  type XaiGrokAuthStatus
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

  async function completeOpenAICodexBrowserLoginFromUrl(
    callbackUrl: string
  ): Promise<OpenAICodexAuthStatus> {
    const result = await bridge.invoke(oauthOpenAICodexCompleteBrowserLoginFromUrlRoute.name, {
      callbackUrl
    })
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

  async function getXaiGrokStatus(): Promise<XaiGrokAuthStatus> {
    const result = await bridge.invoke(oauthXaiGrokGetStatusRoute.name, {})
    return result.status
  }

  async function startXaiGrokDeviceLogin(): Promise<XaiGrokAuthStatus> {
    const result = await bridge.invoke(oauthXaiGrokStartDeviceLoginRoute.name, {})
    return result.status
  }

  async function cancelXaiGrokLogin(): Promise<XaiGrokAuthStatus> {
    const result = await bridge.invoke(oauthXaiGrokCancelLoginRoute.name, {})
    return result.status
  }

  async function logoutXaiGrok(): Promise<XaiGrokAuthStatus> {
    const result = await bridge.invoke(oauthXaiGrokLogoutRoute.name, {})
    return result.status
  }

  function onXaiGrokStatusChanged(listener: (status: XaiGrokAuthStatus) => void): () => void {
    return bridge.on(oauthXaiGrokStatusChangedEvent.name, (payload) => {
      listener(payload.status)
    })
  }

  return {
    startGitHubCopilotLogin,
    startGitHubCopilotDeviceFlowLogin,
    getOpenAICodexStatus,
    startOpenAICodexBrowserLogin,
    completeOpenAICodexBrowserLoginFromUrl,
    cancelOpenAICodexLogin,
    logoutOpenAICodex,
    onOpenAICodexStatusChanged,
    getXaiGrokStatus,
    startXaiGrokDeviceLogin,
    cancelXaiGrokLogin,
    logoutXaiGrok,
    onXaiGrokStatusChanged
  }
}

export type OAuthClient = ReturnType<typeof createOAuthClient>
