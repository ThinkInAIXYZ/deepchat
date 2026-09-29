import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import AcpElicitationForm from '@/components/acp/AcpElicitationForm.vue'
import { useAcpExtensionsStore } from '@/stores/acpExtensions'
import type { AcpElicitationView } from '@shared/types/acp-elicitation'

const api = vi.hoisted(() => ({
  listElicitations: vi.fn(),
  inspect: vi.fn(async () => ({ state: null })),
  onExtensionsChanged: vi.fn(() => () => {}),
  respond: vi.fn(),
  onElicitationChanged: vi.fn(() => () => {})
}))
vi.unmock('pinia')
vi.mock('@api/AcpExtensionsClient', () => ({ createAcpExtensionsClient: () => api }))
vi.mock('@api/BrowserClient', () => ({ createBrowserClient: () => ({ openExternal: vi.fn() }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

describe('ACP structured question form', () => {
  it('submits enum values, arrays, and a masked note together and preserves input on failure', async () => {
    setActivePinia(createPinia())
    const request: AcpElicitationView = {
      requestId: 'form-1',
      agentId: 'fixture',
      agentName: 'Fixture',
      mode: 'form',
      message: 'Choose',
      status: 'pending',
      fields: [
        {
          name: 'region',
          title: 'Region',
          type: 'single-select',
          required: true,
          options: [
            { value: 'eu', title: 'Europe' },
            { value: 'us', title: 'America' }
          ]
        },
        {
          name: 'checks',
          title: 'Checks',
          type: 'multi-select',
          required: false,
          options: [
            { value: 'a,b', title: 'Combined check' },
            { value: 'c', title: 'Third check' }
          ]
        },
        {
          name: 'note',
          title: 'Private note',
          type: 'string',
          required: false,
          secret: true,
          noteFor: 'region'
        }
      ]
    }
    api.listElicitations.mockResolvedValue({ requests: [request], version: 1 })
    api.respond.mockRejectedValueOnce(new Error('Unavailable'))
    const store = useAcpExtensionsStore()
    await flushPromises()
    const wrapper = mount(AcpElicitationForm, {
      props: { request },
      global: { stubs: { DcButton: { template: '<button><slot /></button>' } } }
    })
    await wrapper.get('input[value="eu"]').setValue(true)
    await wrapper.get('input[value="a,b"]').setValue(true)
    await wrapper.get('input[value="c"]').setValue(true)
    await wrapper.get('input[type="password"]').setValue('Keep private')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.respond).toHaveBeenCalledWith({
      requestId: 'form-1',
      action: 'accept',
      content: { region: 'eu', checks: ['a,b', 'c'], note: 'Keep private' }
    })
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    expect(store.values['form-1'].note).toBe('Keep private')
    api.respond.mockResolvedValueOnce({ resolved: true })
    api.listElicitations.mockResolvedValueOnce({ requests: [], version: 2 })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(store.values['form-1']).toBeUndefined()
    wrapper.unmount()
    store.$dispose()
  })
})
