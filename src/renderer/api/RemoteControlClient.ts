import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  remoteControlCancelFeishuAuthRoute,
  remoteControlCancelFeishuInstallRoute,
  remoteControlClearChannelPairCodeRoute,
  remoteControlCreateChannelPairCodeRoute,
  remoteControlGetChannelBindingsRoute,
  remoteControlGetChannelPairingSnapshotRoute,
  remoteControlGetChannelSettingsRoute,
  remoteControlGetChannelStatusRoute,
  remoteControlGetTelegramStatusRoute,
  remoteControlGetWeixinIlinkStatusRoute,
  remoteControlListChannelsRoute,
  remoteControlRemoveChannelBindingRoute,
  remoteControlRemoveChannelPrincipalRoute,
  remoteControlRemoveWeixinIlinkAccountRoute,
  remoteControlRestartWeixinIlinkAccountRoute,
  remoteControlSaveChannelSettingsRoute,
  remoteControlStartFeishuAuthRoute,
  remoteControlStartFeishuInstallRoute,
  remoteControlStartWeixinIlinkLoginRoute,
  remoteControlWaitForFeishuAuthRoute,
  remoteControlWaitForFeishuInstallRoute,
  remoteControlWaitForWeixinIlinkLoginRoute
} from '@shared/contracts/routes'
import type {
  ChannelSettingsMap,
  PairableRemoteChannel,
  RemoteChannel,
  RemoteChannelSettings
} from '@shared/presenter'
import { getDeepchatBridge } from './core'

export function createRemoteControlClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function listRemoteChannels() {
    const result = await bridge.invoke(remoteControlListChannelsRoute.name, {})
    return result.channels
  }

  async function getChannelSettings<T extends RemoteChannel>(
    channel: T
  ): Promise<ChannelSettingsMap[T]> {
    const result = await bridge.invoke(remoteControlGetChannelSettingsRoute.name, { channel })
    return result.settings as ChannelSettingsMap[T]
  }

  async function saveChannelSettings<T extends RemoteChannel>(
    channel: T,
    settings: ChannelSettingsMap[T]
  ): Promise<ChannelSettingsMap[T]> {
    const result = await bridge.invoke(remoteControlSaveChannelSettingsRoute.name, {
      channel,
      settings
    })
    return result.settings as ChannelSettingsMap[T]
  }

  async function getChannelStatus(channel: RemoteChannel) {
    const result = await bridge.invoke(remoteControlGetChannelStatusRoute.name, { channel })
    return result.status
  }

  async function getChannelBindings(channel: RemoteChannel) {
    const result = await bridge.invoke(remoteControlGetChannelBindingsRoute.name, { channel })
    return result.bindings
  }

  async function removeChannelBinding(channel: RemoteChannel, endpointKey: string) {
    await bridge.invoke(remoteControlRemoveChannelBindingRoute.name, { channel, endpointKey })
  }

  async function removeChannelPrincipal(channel: PairableRemoteChannel, principalId: string) {
    await bridge.invoke(remoteControlRemoveChannelPrincipalRoute.name, { channel, principalId })
  }

  async function getChannelPairingSnapshot(channel: PairableRemoteChannel) {
    const result = await bridge.invoke(remoteControlGetChannelPairingSnapshotRoute.name, {
      channel
    })
    return result.snapshot
  }

  async function createChannelPairCode(channel: PairableRemoteChannel) {
    return await bridge.invoke(remoteControlCreateChannelPairCodeRoute.name, { channel })
  }

  async function clearChannelPairCode(channel: PairableRemoteChannel) {
    await bridge.invoke(remoteControlClearChannelPairCodeRoute.name, { channel })
  }

  async function getTelegramStatus() {
    const result = await bridge.invoke(remoteControlGetTelegramStatusRoute.name, {})
    return result.status
  }

  async function startFeishuAuth(input?: {
    brand?: 'feishu' | 'lark'
    appId?: string
    appSecret?: string
    redirectUri?: string
  }) {
    const result = await bridge.invoke(remoteControlStartFeishuAuthRoute.name, input ?? {})
    return result.session
  }

  async function waitForFeishuAuth(input: { sessionKey: string; timeoutMs?: number }) {
    const result = await bridge.invoke(remoteControlWaitForFeishuAuthRoute.name, input)
    return result.result
  }

  async function cancelFeishuAuth(sessionKey: string) {
    await bridge.invoke(remoteControlCancelFeishuAuthRoute.name, { sessionKey })
  }

  async function startFeishuInstall(input?: { brand?: 'feishu' | 'lark' }) {
    const result = await bridge.invoke(remoteControlStartFeishuInstallRoute.name, input ?? {})
    return result.session
  }

  async function waitForFeishuInstall(input: { sessionKey: string; timeoutMs?: number }) {
    const result = await bridge.invoke(remoteControlWaitForFeishuInstallRoute.name, input)
    return result.result
  }

  async function cancelFeishuInstall(sessionKey: string) {
    await bridge.invoke(remoteControlCancelFeishuInstallRoute.name, { sessionKey })
  }

  async function getWeixinIlinkStatus() {
    const result = await bridge.invoke(remoteControlGetWeixinIlinkStatusRoute.name, {})
    return result.status
  }

  async function startWeixinIlinkLogin(input?: { force?: boolean }) {
    const result = await bridge.invoke(remoteControlStartWeixinIlinkLoginRoute.name, input ?? {})
    return result.session
  }

  async function waitForWeixinIlinkLogin(input: { sessionKey: string; timeoutMs?: number }) {
    const result = await bridge.invoke(remoteControlWaitForWeixinIlinkLoginRoute.name, input)
    return result.result
  }

  async function removeWeixinIlinkAccount(accountId: string) {
    await bridge.invoke(remoteControlRemoveWeixinIlinkAccountRoute.name, { accountId })
  }

  async function restartWeixinIlinkAccount(accountId: string) {
    await bridge.invoke(remoteControlRestartWeixinIlinkAccountRoute.name, { accountId })
  }

  return {
    listRemoteChannels,
    getChannelSettings,
    saveChannelSettings,
    getChannelStatus,
    getChannelBindings,
    removeChannelBinding,
    removeChannelPrincipal,
    getChannelPairingSnapshot,
    createChannelPairCode,
    clearChannelPairCode,
    getTelegramStatus,
    startFeishuAuth,
    waitForFeishuAuth,
    cancelFeishuAuth,
    startFeishuInstall,
    waitForFeishuInstall,
    cancelFeishuInstall,
    getWeixinIlinkStatus,
    startWeixinIlinkLogin,
    waitForWeixinIlinkLogin,
    removeWeixinIlinkAccount,
    restartWeixinIlinkAccount
  }
}

export type RemoteControlClient = ReturnType<typeof createRemoteControlClient>
export type RemoteControlClientSettings = RemoteChannelSettings
