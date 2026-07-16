import type { RemoteServicePort } from '@shared/types/remote'
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
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createRemoteRoutes(remoteService: RemoteServicePort): DeepchatRouteMap {
  return createRouteMap([
    [
      remoteControlListChannelsRoute.name,
      async (rawInput) => {
        remoteControlListChannelsRoute.input.parse(rawInput)
        return remoteControlListChannelsRoute.output.parse({
          channels: await remoteService.listRemoteChannels()
        })
      }
    ],
    [
      remoteControlGetChannelSettingsRoute.name,
      async (rawInput) => {
        const input = remoteControlGetChannelSettingsRoute.input.parse(rawInput)
        return remoteControlGetChannelSettingsRoute.output.parse({
          settings: await remoteService.getChannelSettings(input.channel)
        })
      }
    ],
    [
      remoteControlSaveChannelSettingsRoute.name,
      async (rawInput) => {
        const input = remoteControlSaveChannelSettingsRoute.input.parse(rawInput)
        return remoteControlSaveChannelSettingsRoute.output.parse({
          settings: await remoteService.saveChannelSettings(input.channel, input.settings)
        })
      }
    ],
    [
      remoteControlGetChannelStatusRoute.name,
      async (rawInput) => {
        const input = remoteControlGetChannelStatusRoute.input.parse(rawInput)
        return remoteControlGetChannelStatusRoute.output.parse({
          status: await remoteService.getChannelStatus(input.channel)
        })
      }
    ],
    [
      remoteControlGetChannelBindingsRoute.name,
      async (rawInput) => {
        const input = remoteControlGetChannelBindingsRoute.input.parse(rawInput)
        return remoteControlGetChannelBindingsRoute.output.parse({
          bindings: await remoteService.getChannelBindings(input.channel)
        })
      }
    ],
    [
      remoteControlRemoveChannelBindingRoute.name,
      async (rawInput) => {
        const input = remoteControlRemoveChannelBindingRoute.input.parse(rawInput)
        await remoteService.removeChannelBinding(input.channel, input.endpointKey)
        return remoteControlRemoveChannelBindingRoute.output.parse({ removed: true })
      }
    ],
    [
      remoteControlRemoveChannelPrincipalRoute.name,
      async (rawInput) => {
        const input = remoteControlRemoveChannelPrincipalRoute.input.parse(rawInput)
        await remoteService.removeChannelPrincipal(input.channel, input.principalId)
        return remoteControlRemoveChannelPrincipalRoute.output.parse({ removed: true })
      }
    ],
    [
      remoteControlGetChannelPairingSnapshotRoute.name,
      async (rawInput) => {
        const input = remoteControlGetChannelPairingSnapshotRoute.input.parse(rawInput)
        return remoteControlGetChannelPairingSnapshotRoute.output.parse({
          snapshot: await remoteService.getChannelPairingSnapshot(input.channel)
        })
      }
    ],
    [
      remoteControlCreateChannelPairCodeRoute.name,
      async (rawInput) => {
        const input = remoteControlCreateChannelPairCodeRoute.input.parse(rawInput)
        return remoteControlCreateChannelPairCodeRoute.output.parse(
          await remoteService.createChannelPairCode(input.channel)
        )
      }
    ],
    [
      remoteControlClearChannelPairCodeRoute.name,
      async (rawInput) => {
        const input = remoteControlClearChannelPairCodeRoute.input.parse(rawInput)
        await remoteService.clearChannelPairCode(input.channel)
        return remoteControlClearChannelPairCodeRoute.output.parse({ cleared: true })
      }
    ],
    [
      remoteControlGetTelegramStatusRoute.name,
      async (rawInput) => {
        remoteControlGetTelegramStatusRoute.input.parse(rawInput)
        return remoteControlGetTelegramStatusRoute.output.parse({
          status: await remoteService.getTelegramStatus()
        })
      }
    ],
    [
      remoteControlStartFeishuAuthRoute.name,
      async (rawInput) => {
        const input = remoteControlStartFeishuAuthRoute.input.parse(rawInput)
        return remoteControlStartFeishuAuthRoute.output.parse({
          session: await remoteService.startFeishuAuth(input)
        })
      }
    ],
    [
      remoteControlWaitForFeishuAuthRoute.name,
      async (rawInput) => {
        const input = remoteControlWaitForFeishuAuthRoute.input.parse(rawInput)
        return remoteControlWaitForFeishuAuthRoute.output.parse({
          result: await remoteService.waitForFeishuAuth(input)
        })
      }
    ],
    [
      remoteControlCancelFeishuAuthRoute.name,
      async (rawInput) => {
        const input = remoteControlCancelFeishuAuthRoute.input.parse(rawInput)
        await remoteService.cancelFeishuAuth(input.sessionKey)
        return remoteControlCancelFeishuAuthRoute.output.parse({ cancelled: true })
      }
    ],
    [
      remoteControlStartFeishuInstallRoute.name,
      async (rawInput) => {
        const input = remoteControlStartFeishuInstallRoute.input.parse(rawInput)
        return remoteControlStartFeishuInstallRoute.output.parse({
          session: await remoteService.startFeishuInstall(input)
        })
      }
    ],
    [
      remoteControlWaitForFeishuInstallRoute.name,
      async (rawInput) => {
        const input = remoteControlWaitForFeishuInstallRoute.input.parse(rawInput)
        return remoteControlWaitForFeishuInstallRoute.output.parse({
          result: await remoteService.waitForFeishuInstall(input)
        })
      }
    ],
    [
      remoteControlCancelFeishuInstallRoute.name,
      async (rawInput) => {
        const input = remoteControlCancelFeishuInstallRoute.input.parse(rawInput)
        await remoteService.cancelFeishuInstall(input.sessionKey)
        return remoteControlCancelFeishuInstallRoute.output.parse({ cancelled: true })
      }
    ],
    [
      remoteControlGetWeixinIlinkStatusRoute.name,
      async (rawInput) => {
        remoteControlGetWeixinIlinkStatusRoute.input.parse(rawInput)
        return remoteControlGetWeixinIlinkStatusRoute.output.parse({
          status: await remoteService.getWeixinIlinkStatus()
        })
      }
    ],
    [
      remoteControlStartWeixinIlinkLoginRoute.name,
      async (rawInput) => {
        const input = remoteControlStartWeixinIlinkLoginRoute.input.parse(rawInput)
        return remoteControlStartWeixinIlinkLoginRoute.output.parse({
          session: await remoteService.startWeixinIlinkLogin(input)
        })
      }
    ],
    [
      remoteControlWaitForWeixinIlinkLoginRoute.name,
      async (rawInput) => {
        const input = remoteControlWaitForWeixinIlinkLoginRoute.input.parse(rawInput)
        return remoteControlWaitForWeixinIlinkLoginRoute.output.parse({
          result: await remoteService.waitForWeixinIlinkLogin(input)
        })
      }
    ],
    [
      remoteControlRemoveWeixinIlinkAccountRoute.name,
      async (rawInput) => {
        const input = remoteControlRemoveWeixinIlinkAccountRoute.input.parse(rawInput)
        await remoteService.removeWeixinIlinkAccount(input.accountId)
        return remoteControlRemoveWeixinIlinkAccountRoute.output.parse({ removed: true })
      }
    ],
    [
      remoteControlRestartWeixinIlinkAccountRoute.name,
      async (rawInput) => {
        const input = remoteControlRestartWeixinIlinkAccountRoute.input.parse(rawInput)
        await remoteService.restartWeixinIlinkAccount(input.accountId)
        return remoteControlRestartWeixinIlinkAccountRoute.output.parse({ restarted: true })
      }
    ]
  ])
}
