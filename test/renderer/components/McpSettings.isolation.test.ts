import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, disposePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { settingsRouteComponents } from '../../../src/renderer/settings/settingsRouteComponents'

vi.unmock('pinia')
vi.unmock('vue-i18n')
vi.unmock('vue-router')

it.each(['settings', 'plugins'])(
  'isolates the real global MCP subtree in the %s route across reentry',
  async (entry) => {
    const pinia = createPinia()
    const listeners = new Map<string, Set<unknown>>()
    const originalInvoke = vi.mocked(window.deepchat.invoke).getMockImplementation()!
    const invoke = vi.spyOn(window.deepchat, 'invoke').mockImplementation(async (name, input) => {
      switch (name) {
        case 'mcp.getServers':
          return { servers: { demo: { type: 'stdio', command: 'demo', enabled: true } } }
        case 'mcp.getEnabled':
          return { enabled: true }
        case 'mcp.getClients':
          return { clients: [] }
        case 'mcp.listToolDefinitions':
          return { tools: [] }
        case 'mcp.listPrompts':
          return { prompts: [] }
        case 'mcp.listResources':
          return { resources: [] }
        case 'mcp.getServerDiagnostics':
          return { diagnostics: { lifecycleStatus: 'stopped', connectionState: 'stopped' } }
        case 'mcp.getServerAuthStatus':
          return { status: { serverName: 'demo', state: 'none', authenticated: false } }
        case 'mcp.isServerRunning':
          return { running: false }
        case 'mcp.getNpmRegistryStatus':
          return { status: { currentRegistry: null, isFromCache: false, autoDetectEnabled: true } }
        default:
          return originalInvoke(name, input)
      }
    })
    const on = vi.spyOn(window.deepchat, 'on').mockImplementation((name, listener) => {
      const active = listeners.get(name) ?? new Set()
      listeners.set(name, active)
      active.add(listener)
      return () => {
        active.delete(listener)
      }
    })
    const component =
      entry === 'settings'
        ? (await settingsRouteComponents['settings-mcp']()).default
        : (await import('../../../src/renderer/src/pages/plugins/McpPluginsPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/mcp', name: `${entry}-mcp`, component },
        { path: '/away', component: { template: '<div />' } }
      ]
    })
    await router.push('/mcp')
    await router.isReady()
    const wrapper = mount(RouterView, {
      global: {
        plugins: [
          pinia,
          PiniaColada,
          router,
          createI18n({ legacy: false, locale: 'en-US', missingWarn: false, fallbackWarn: false })
        ]
      }
    })
    try {
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('demo'))
      const assertIsolated = () => {
        expect(pinia.state.value).not.toHaveProperty('session')
        expect(pinia.state.value).not.toHaveProperty('message')
        expect(pinia.state.value).not.toHaveProperty('agent')
        expect(
          on.mock.calls
            .map(([name]) => name)
            .some((name) => /^(chat|sessions|messages)\./.test(name))
        ).toBe(false)
        expect(invoke.mock.calls.some(([name]) => /^(chat|sessions|messages)\./.test(name))).toBe(
          false
        )
      }
      assertIsolated()
      const initialSubscriptions = on.mock.calls.length
      expect(initialSubscriptions).toBeGreaterThan(0)
      await router.push('/away')
      await flushPromises()
      await router.push('/mcp')
      await flushPromises()
      expect(wrapper.text()).toContain('demo')
      assertIsolated()
      for (const active of listeners.values()) expect(active.size).toBeLessThanOrEqual(1)
      expect(invoke).toHaveBeenCalledWith('mcp.getServers', {})
    } finally {
      wrapper.unmount()
      disposePinia(pinia)
      expect([...listeners.values()].every((active) => active.size === 0)).toBe(true)
      on.mockRestore()
      invoke.mockRestore()
    }
  },
  20_000
)
