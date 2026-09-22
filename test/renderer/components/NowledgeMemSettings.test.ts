import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { NowledgePluginState } from '@shared/types/nowledgeMemPlugin'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

async function setup() {
  vi.resetModules()
  let state: NowledgePluginState = {
    connection: {
      baseUrl: 'https://mem.example.test',
      apiBaseUrl: 'https://mem.example.test/remote-api',
      mcpUrl: 'https://mem.example.test/remote-api/mcp/',
      timeout: 30000,
      verifiedAt: 1,
      hasApiKey: true
    },
    legacy: []
  }
  const client = {
    getConnections: vi.fn(async () => structuredClone(state)),
    saveConnection: vi.fn(async (input) => {
      state = {
        ...state,
        connection: { ...state.connection!, baseUrl: input.baseUrl }
      }
      return structuredClone(state)
    })
  }
  const requestLeave = vi.fn().mockResolvedValue(false)
  vi.doMock('@api/NowledgeMemClient', () => ({ createNowledgeMemClient: () => client }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
  vi.doMock('../../../src/renderer/settings/services/settingsLeaveGuard', () => ({
    settingsLeaveGuard: { requestLeave, register: () => ({ setRisk: vi.fn(), release: vi.fn() }) }
  }))
  vi.doMock('@dc-ui/components/button', () => ({
    DcButton: defineComponent({ template: '<button><slot /></button>' })
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: defineComponent({
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template:
        '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
    })
  }))
  vi.doMock('@shadcn/components/ui/label', () => ({
    Label: defineComponent({ template: '<label><slot /></label>' })
  }))
  const Component = (
    await import('../../../src/renderer/settings/components/NowledgeMemSettings.vue')
  ).default
  const wrapper = mount(Component)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, client, requestLeave }
}

describe('Nowledge plugin settings', () => {
  it('shows only an address and optional key without exposing saved credentials', async () => {
    const { wrapper, client } = await setup()
    expect(wrapper.findAll('input')).toHaveLength(2)
    expect(wrapper.text()).toContain('settings.nowledgePlugin.apiKey')
    expect(wrapper.get('[data-testid=nowledge-mem-base-url-input]').element).toHaveProperty(
      'value',
      'https://mem.example.test'
    )
    expect(wrapper.get('[data-testid=nowledge-mem-api-key-input]').element).toHaveProperty(
      'value',
      ''
    )
    expect(wrapper.get('[data-testid=nowledge-mem-api-key-input]').attributes('type')).toBe(
      'password'
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(client.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: '', apiBaseUrl: 'https://mem.example.test/remote-api' })
    )
  })

  it('confirms a changed address on save and keeps the draft when canceled', async () => {
    const { wrapper, client } = await setup()
    await wrapper
      .get('[data-testid=nowledge-mem-base-url-input]')
      .setValue('http://192.168.1.2:14242')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(client.saveConnection).not.toHaveBeenCalled()
    const dialog = wrapper.findAllComponents({ name: 'DcConfirmDialog' })[0]
    expect(dialog.props('open')).toBe(true)
    dialog.vm.$emit('update:open', false)
    await flushPromises()
    expect(wrapper.get('[data-testid=nowledge-mem-base-url-input]').element).toHaveProperty(
      'value',
      'http://192.168.1.2:14242'
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(client.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://192.168.1.2:14242',
        replace: true,
        apiBaseUrl: '',
        mcpUrl: '',
        apiKey: ''
      })
    )
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('retains the draft and shows authentication errors without reporting success', async () => {
    const { wrapper, client } = await setup()
    client.saveConnection.mockRejectedValueOnce(new Error('REST authentication: HTTP 401'))
    await wrapper.get('[data-testid=nowledge-mem-api-key-input]').setValue('wrong-key')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('HTTP 401')
    expect(wrapper.get('[data-testid=nowledge-mem-api-key-input]').element).toHaveProperty(
      'value',
      'wrong-key'
    )
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows persisted connection state with an activation warning instead of a save failure', async () => {
    const { wrapper, client } = await setup()
    const saved = await client.getConnections()
    client.saveConnection.mockResolvedValueOnce({ ...saved, activationFailed: true })
    await wrapper.get('[data-testid=nowledge-mem-api-key-input]').setValue('new-key')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('settings.nowledgePlugin.activationFailed')
    expect(wrapper.get('[data-testid=nowledge-mem-api-key-input]').element).toHaveProperty(
      'value',
      ''
    )
    expect(wrapper.text()).not.toContain('settings.nowledgePlugin.verified')
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('blocks conflicting actions while verification is pending', async () => {
    const { wrapper, client } = await setup()
    let resolve!: (state: NowledgePluginState) => void
    client.saveConnection.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    resolve(await client.getConnections())
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
  })
})
