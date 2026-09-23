import type { SyncTunnelConfig } from '@shared/contracts/routes/syncHost.routes'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { getDeepchatBridge } from './core'

export function createTunnelSyncClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  return {
    onChanged: (listener: () => void) => bridge.on('sync.device.changed', listener),
    setAutomatic: (enabled: boolean) => bridge.invoke('syncPeer.setAutomatic', { enabled }),
    syncNow: () => bridge.invoke('syncPeer.syncNow', {}),
    hostStatus: () => bridge.invoke('syncHost.getStatus', {}),
    setEnabled: (
      enabled: boolean,
      port?: number,
      consent?: boolean,
      tunnel?: SyncTunnelConfig & { token?: string },
      bidirectional = false
    ) => bridge.invoke('syncHost.setEnabled', { enabled, port, consent, tunnel, bidirectional }),
    publish: () => bridge.invoke('syncHost.publish', {}),
    createCode: () => bridge.invoke('syncHost.createPairingCode', {}),
    devices: () => bridge.invoke('syncHost.listDevices', {}),
    revoke: (deviceId: string) => bridge.invoke('syncHost.revokeDevice', { deviceId }),
    rename: (deviceId: string, name: string) =>
      bridge.invoke('syncHost.renameDevice', { deviceId, name }),
    setDeviceWritable: (deviceId: string, writable: boolean) =>
      bridge.invoke('syncHost.setDeviceWritable', { deviceId, writable }),
    peerStatus: () => bridge.invoke('syncPeer.getStatus', {}),
    pair: (input: {
      hostUrl: string
      hostId: string
      code: string
      deviceName: string
      bidirectional?: boolean
    }) => bridge.invoke('syncPeer.pair', input),
    pull: (mode: 'increment' | 'overwrite', confirmOverwrite = false) =>
      bridge.invoke('syncPeer.pull', { mode, confirmOverwrite }),
    cancel: () => bridge.invoke('syncPeer.cancel', {}),
    forget: () => bridge.invoke('syncPeer.forget', {})
  }
}
