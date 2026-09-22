import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { createTunnelSyncClient } from '@api/TunnelSyncClient'

export const useTunnelSyncStore = defineStore('tunnelSync', () => {
  const client = createTunnelSyncClient()
  const host = ref<Awaited<ReturnType<typeof client.hostStatus>> | null>(null)
  const peer = ref<Awaited<ReturnType<typeof client.peerStatus>> | null>(null)
  const devices = ref<Awaited<ReturnType<typeof client.devices>>['devices']>([])
  const busy = ref(false)
  const error = ref<string | null>(null)
  let refreshing = false
  const transferring = computed(() =>
    ['pairing', 'preparing', 'downloading', 'verifying', 'importing'].includes(
      peer.value?.phase ?? ''
    )
  )

  function errorKey(value: unknown): string {
    const message = value instanceof Error ? value.message : ''
    return (
      message.match(/sync\.(?:tunnel\.error\.|error\.)[a-zA-Z]+/)?.[0] ??
      (message.includes('syncHost.error.bindFailed')
        ? 'sync.tunnel.error.bindFailed'
        : 'sync.tunnel.error.connectionFailed')
    )
  }

  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      const [nextHost, nextPeer, nextDevices] = await Promise.allSettled([
        client.hostStatus(),
        client.peerStatus(),
        client.devices()
      ])
      if (nextHost.status === 'fulfilled') host.value = nextHost.value
      if (nextPeer.status === 'fulfilled') peer.value = nextPeer.value
      if (nextDevices.status === 'fulfilled') devices.value = nextDevices.value.devices
      for (const result of [nextHost, nextPeer, nextDevices]) {
        if (result.status === 'rejected') error.value = errorKey(result.reason)
      }
    } catch (value) {
      error.value = errorKey(value)
    } finally {
      refreshing = false
    }
  }

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = null
    try {
      await action()
      await refresh()
      return true
    } catch (value) {
      error.value = errorKey(value)
      return false
    } finally {
      busy.value = false
    }
  }

  return { client, host, peer, devices, busy, error, transferring, refresh, run }
})
