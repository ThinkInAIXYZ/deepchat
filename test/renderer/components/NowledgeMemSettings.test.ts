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
const button = (wrapper: VueWrapper, key: string) =>
  wrapper.findAll('button').find((item) => item.text() === `settings.nowledgePlugin.${key}`)!

async function setup() {
  vi.resetModules()
  let state: NowledgePluginState = {
    connections: {
      local: {
        profile: 'local',
        baseUrl: 'http://127.0.0.1:14242',
        apiBaseUrl: 'http://127.0.0.1:14242',
        mcpUrl: 'http://127.0.0.1:14242/mcp/',
        timeout: 30000,
        verifiedAt: 1,
        hasApiKey: false
      },
      remote: {
        profile: 'remote',
        baseUrl: 'https://mem.example.test',
        apiBaseUrl: 'https://mem.example.test/remote-api',
        mcpUrl: 'https://mem.example.test/remote-api/mcp/',
        timeout: 30000,
        verifiedAt: 1,
        hasApiKey: true
      }
    },
    exportProfile: 'local',
    legacy: []
  }
  const client = {
    getConnections: vi.fn(async () => structuredClone(state)),
    saveConnection: vi.fn(async (input) => {
      state = {
        ...state,
        connections: {
          ...state.connections,
          [input.profile]: {
            ...state.connections[input.profile as 'local' | 'remote'],
            baseUrl: input.baseUrl
          }
        }
      }
      return structuredClone(state)
    }),
    selectExport: vi.fn(async (profile) => ({ ...state, exportProfile: profile }))
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
  it('keeps stored keys out of the form and selects a verified export profile independently', async () => {
    const { wrapper, client } = await setup()
    await button(wrapper, 'remote').trigger('click')
    await flushPromises()
    expect(
      (wrapper.get('[data-testid=nowledge-mem-api-key-input]').element as HTMLInputElement).value
    ).toBe('')
    expect(wrapper.get('[data-testid=nowledge-mem-api-key-input]').attributes('type')).toBe(
      'password'
    )
    await button(wrapper, 'useForExports').trigger('click')
    await flushPromises()
    expect(client.selectExport).toHaveBeenCalledWith('remote')
    expect(button(wrapper, 'exportSelected').exists()).toBe(true)
    expect(client.saveConnection).not.toHaveBeenCalled()
  })

  it('requires confirmation when changing the saved destination and preserves dirty drafts on cancellation', async () => {
    const { wrapper, client, requestLeave } = await setup()
    await wrapper
      .get('[data-testid=nowledge-mem-base-url-input]')
      .setValue('http://127.0.0.1:15555')
    expect(
      wrapper.get('[data-testid=nowledge-mem-save-button]').attributes('disabled')
    ).toBeDefined()
    await button(wrapper, 'remote').trigger('click')
    await flushPromises()
    expect(requestLeave).toHaveBeenCalled()
    expect(
      (wrapper.get('[data-testid=nowledge-mem-base-url-input]').element as HTMLInputElement).value
    ).toContain('15555')
    await wrapper.get('[role=checkbox]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(client.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:15555',
        replace: true,
        profile: 'local'
      })
    )
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('retains the draft and clears a potentially consumed connect link after failed verification', async () => {
    const { wrapper, client } = await setup()
    await button(wrapper, 'remote').trigger('click')
    await flushPromises()
    client.saveConnection.mockRejectedValueOnce(new Error('REST authentication: HTTP 401'))
    await wrapper
      .findAll('input[type=password]')[1]
      .setValue('https://mem.example.test/app?nmem_connect=once')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('HTTP 401')
    expect((wrapper.findAll('input[type=password]')[1].element as HTMLInputElement).value).toBe('')
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
    expect(button(wrapper, 'remote').attributes('disabled')).toBeDefined()
    resolve(await client.getConnections())
    await flushPromises()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
  })
})
