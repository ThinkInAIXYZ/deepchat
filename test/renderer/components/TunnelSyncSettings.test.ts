import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import TunnelSyncSettings from '../../../src/renderer/settings/components/TunnelSyncSettings.vue'
import { useTunnelSyncStore } from '../../../src/renderer/settings/stores/tunnelSync'
import settings from '../../../src/renderer/src/i18n/en-US/settings.json'
import sync from '../../../src/renderer/src/i18n/en-US/sync.json'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@api/ToolchainClient', () => ({
  createToolchainClient: () => ({
    getStatus: async () => ({
      cloudflared: { availability: 'ready', selection: { source: 'bundled' } }
    }),
    onChanged: () => () => {}
  })
}))
vi.unmock('pinia')
vi.unmock('vue-i18n')

const client = vi.hoisted(() => ({
  onChanged: () => () => {},
  setAutomatic: vi.fn(),
  setEnabled: vi.fn(),
  syncNow: vi.fn(),
  hostStatus: vi.fn(),
  peerStatus: vi.fn(),
  devices: vi.fn(),
  pair: vi.fn(),
  pull: vi.fn(),
  cancel: vi.fn(),
  createCode: vi.fn(),
  setDeviceWritable: vi.fn()
}))
vi.mock('@api/TunnelSyncClient', () => ({ createTunnelSyncClient: () => client }))

const initialPeer = {
  paired: true,
  canWrite: true,
  hostUrl: 'https://sync.example.test',
  hostId: 'host-1',
  deviceName: 'Laptop',
  phase: 'idle',
  received: 0,
  total: 0,
  lastSuccessAt: null,
  error: null
}
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.resetAllMocks()
})

async function render() {
  client.hostStatus.mockResolvedValue({
    status: {
      enabled: false,
      running: false,
      port: null,
      configuredPort: 0,
      hostId: 'local',
      deviceCount: 0,
      hasSnapshot: false,
      publishedAt: null
    },
    pairing: null
  })
  client.peerStatus.mockResolvedValue(initialPeer)
  client.devices.mockResolvedValue({ devices: [] })
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(TunnelSyncSettings, {
    global: {
      plugins: [
        pinia,
        createI18n({
          legacy: false,
          locale: 'en',
          messages: { en: { sync, settings, common: { cancel: 'Cancel' } } }
        })
      ],
      stubs: {
        DcButton: defineComponent({
          props: ['disabled'],
          emits: ['click'],
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
        }),
        DcConfirmDialog: defineComponent({
          props: ['open'],
          emits: ['confirm'],
          template:
            '<div v-if="open" role="alertdialog"><slot /><button @click="$emit(\'confirm\')">Confirm</button></div>'
        })
      }
    }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('TunnelSyncSettings', () => {
  it('does not request write access without the receiving device opting in', async () => {
    const wrapper = await render()
    useTunnelSyncStore().peer = { ...initialPeer, paired: false }
    await flushPromises()
    client.pair.mockResolvedValue(initialPeer)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Connect device')!
      .trigger('click')
    await wrapper
      .get('#tunnel-pairing-input')
      .setValue(
        JSON.stringify({ hostUrl: 'https://sync.example.test', hostId: 'host-1', code: 'ABCD1234' })
      )
    await wrapper.get('#tunnel-device-name').setValue('Laptop')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Connect')!
      .trigger('click')
    await flushPromises()
    expect(client.pair).toHaveBeenCalledWith({
      hostUrl: 'https://sync.example.test',
      hostId: 'host-1',
      code: 'ABCD1234',
      deviceName: 'Laptop',
      bidirectional: false
    })
  })
  it('shows invalid port and connection errors inside the sharing dialog', async () => {
    const wrapper = await render()
    await wrapper.get('#tunnel-port').setValue('')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Enable sharing')!
      .trigger('click')
    await wrapper.get('[role="alertdialog"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Choose a port')
    expect(client.setEnabled).not.toHaveBeenCalled()

    await wrapper.get('#tunnel-port').setValue('48632')
    client.setEnabled.mockRejectedValue(new Error('sync.tunnel.error.bindFailed'))
    await wrapper.get('[role="alertdialog"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Could not bind')
  })
  it('requires explicit overwrite confirmation and disables cancellation after import begins', async () => {
    const wrapper = await render()
    const overwrite = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Replace local data')!
    await overwrite.trigger('click')
    expect(client.pull).not.toHaveBeenCalled()
    await wrapper.get('[role="alertdialog"] button').trigger('click')
    await flushPromises()
    expect(client.pull).toHaveBeenCalledWith('overwrite', true)

    const store = useTunnelSyncStore()
    store.peer = { ...initialPeer, phase: 'importing', received: 100, total: 100 }
    await flushPromises()
    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancel')!
    expect(cancel.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Importing; cancellation is unavailable')
  })

  it('keeps host controls available when the independent peer credential file cannot be read', async () => {
    const wrapper = await render()
    client.peerStatus.mockRejectedValue(new Error('sync.tunnel.error.credentialsUnavailable'))
    await useTunnelSyncStore().refresh()
    await flushPromises()
    const enable = wrapper.findAll('button').find((button) => button.text() === 'Enable sharing')!
    expect(enable.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('Pairing credentials')
  })
  it('shows two-way timing and busy status and sends Sync now through the automatic path', async () => {
    const wrapper = await render()
    const store = useTunnelSyncStore()
    store.peer = {
      ...initialPeer,
      phase: 'idle',
      automatic: {
        enabled: true,
        phase: 'busy',
        lastSuccessAt: null,
        error: null
      }
    }
    client.syncNow.mockResolvedValue(store.peer)
    await flushPromises()
    expect(wrapper.text()).toContain('15 seconds')
    expect(wrapper.text()).toContain('60 seconds')
    expect(wrapper.text()).toContain('Waiting for active work to finish')
    expect(wrapper.text()).not.toContain('Replace local data')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Sync now')!
      .trigger('click')
    await flushPromises()
    expect(client.syncNow).toHaveBeenCalledOnce()
    expect(client.pull).not.toHaveBeenCalled()
  })

  it('shows why pairing is unavailable until the tunnel connects', async () => {
    const wrapper = await render()
    const store = useTunnelSyncStore()
    store.host = {
      ...store.host!,
      status: {
        ...store.host!.status,
        enabled: true,
        running: true,
        tunnel: {
          phase: 'failed',
          publicUrl: 'https://sync.example.test',
          error: 'sync.tunnel.error.syntheticEdgeIp'
        }
      }
    }
    await flushPromises()
    expect(wrapper.text()).toContain('The tunnel is not connected')
    expect(wrapper.text()).toContain('198.18/15')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === 'Generate connection info')
        ?.attributes('disabled')
    ).toBeDefined()
    expect(wrapper.text()).not.toContain('One-time pairing code')
  })

  it('reveals the one-time code and full connection copy action after generation', async () => {
    const wrapper = await render()
    const store = useTunnelSyncStore()
    const status = {
      ...store.host!.status,
      enabled: true,
      running: true,
      tunnel: { phase: 'connected', publicUrl: 'https://sync.example.test', error: null }
    }
    const pairing = { code: 'ABCDEFGH', hostId: 'local', expiresAt: Date.now() + 60_000 }
    store.host = { status, pairing: null }
    client.hostStatus.mockResolvedValue({ status, pairing })
    client.createCode.mockResolvedValue({ pairing })
    await flushPromises()
    expect(wrapper.text()).not.toContain(pairing.code)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Generate connection info')!
      .trigger('click')
    await flushPromises()
    expect(client.createCode).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain(pairing.code)
    expect(wrapper.text()).toContain('Copy connection info')
    store.peer = { ...initialPeer, paired: false }
    await flushPromises()
    expect(wrapper.text()).toContain(
      'Enable sharing and generate connection info on the other device'
    )
  })
})
