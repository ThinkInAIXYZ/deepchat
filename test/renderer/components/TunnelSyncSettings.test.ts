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
  hostStatus: vi.fn(),
  peerStatus: vi.fn(),
  devices: vi.fn(),
  pull: vi.fn(),
  cancel: vi.fn()
}))
vi.mock('@api/TunnelSyncClient', () => ({ createTunnelSyncClient: () => client }))

const initialPeer = {
  paired: true,
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
            '<div v-if="open" role="alertdialog"><button @click="$emit(\'confirm\')">Confirm</button></div>'
        })
      }
    }
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('TunnelSyncSettings', () => {
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
})
