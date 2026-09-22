import {
  syncPeerGetStatusRoute,
  syncPeerPairRoute,
  syncPeerPullRoute,
  syncPeerCancelRoute,
  syncPeerForgetRoute
} from '@shared/contracts/routes'
import { createRouteMap, requireRendererCaller } from '@/routes/routeRegistry'
import type { SyncPeerService } from './index'

export function createSyncPeerRoutes(peer: SyncPeerService) {
  return createRouteMap([
    [
      syncPeerGetStatusRoute.name,
      async (input, context) => {
        requireRendererCaller(context)
        syncPeerGetStatusRoute.input.parse(input)
        return syncPeerGetStatusRoute.output.parse(await peer.getStatus())
      }
    ],
    [
      syncPeerPairRoute.name,
      async (input, context) => {
        requireRendererCaller(context)
        return syncPeerPairRoute.output.parse(await peer.pair(syncPeerPairRoute.input.parse(input)))
      }
    ],
    [
      syncPeerPullRoute.name,
      async (input, context) => {
        requireRendererCaller(context)
        const { mode, confirmOverwrite } = syncPeerPullRoute.input.parse(input)
        return syncPeerPullRoute.output.parse(await peer.pull(mode, confirmOverwrite))
      }
    ],
    [
      syncPeerCancelRoute.name,
      async (input, context) => {
        requireRendererCaller(context)
        syncPeerCancelRoute.input.parse(input)
        return syncPeerCancelRoute.output.parse(await peer.cancel())
      }
    ],
    [
      syncPeerForgetRoute.name,
      async (input, context) => {
        requireRendererCaller(context)
        syncPeerForgetRoute.input.parse(input)
        return syncPeerForgetRoute.output.parse(await peer.forget())
      }
    ]
  ])
}
