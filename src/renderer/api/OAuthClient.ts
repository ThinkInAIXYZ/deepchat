import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  oauthChatGPTStatusChangedEvent,
  oauthXaiGrokStatusChangedEvent
} from '@shared/contracts/events'
import {
  oauthChatGPTCancelLoginRoute,
  oauthChatGPTDismissNoticeRoute,
  oauthChatGPTGetStatusRoute,
  oauthChatGPTLogoutRoute,
  oauthChatGPTReopenBrowserRoute,
  oauthChatGPTStartLoginRoute,
  oauthGithubCopilotStartDeviceFlowLoginRoute,
  oauthGithubCopilotStartLoginRoute,
  oauthXaiGrokCancelLoginRoute,
  oauthXaiGrokGetStatusRoute,
  oauthXaiGrokLogoutRoute,
  oauthXaiGrokStartDeviceLoginRoute,
  type ChatGPTAuthStatus,
  type ChatGPTLogoutResult,
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

  async function getChatGPTStatus(): Promise<ChatGPTAuthStatus> {
    const result = await bridge.invoke(oauthChatGPTGetStatusRoute.name, {})
    return result.status
  }

  async function startChatGPTLogin(
    options: { requestPlanConsent?: boolean } = {}
  ): Promise<ChatGPTAuthStatus> {
    const result = await bridge.invoke(oauthChatGPTStartLoginRoute.name, options)
    return result.status
  }

  async function reopenChatGPTBrowser(): Promise<ChatGPTAuthStatus> {
    const result = await bridge.invoke(oauthChatGPTReopenBrowserRoute.name, {})
    return result.status
  }

  async function cancelChatGPTLogin(): Promise<ChatGPTAuthStatus> {
    const result = await bridge.invoke(oauthChatGPTCancelLoginRoute.name, {})
    return result.status
  }

  async function logoutChatGPT(): Promise<ChatGPTLogoutResult> {
    return await bridge.invoke(oauthChatGPTLogoutRoute.name, {})
  }

  async function dismissChatGPTNotice(
    notice: 'welcome' | 'codexRetired'
  ): Promise<ChatGPTAuthStatus> {
    const result = await bridge.invoke(oauthChatGPTDismissNoticeRoute.name, { notice })
    return result.status
  }

  function onChatGPTStatusChanged(listener: (status: ChatGPTAuthStatus) => void): () => void {
    return bridge.on(oauthChatGPTStatusChangedEvent.name, (payload) => {
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
    getChatGPTStatus,
    startChatGPTLogin,
    reopenChatGPTBrowser,
    cancelChatGPTLogin,
    logoutChatGPT,
    dismissChatGPTNotice,
    onChatGPTStatusChanged,
    getXaiGrokStatus,
    startXaiGrokDeviceLogin,
    cancelXaiGrokLogin,
    logoutXaiGrok,
    onXaiGrokStatusChanged
  }
}

export type OAuthClient = ReturnType<typeof createOAuthClient>
