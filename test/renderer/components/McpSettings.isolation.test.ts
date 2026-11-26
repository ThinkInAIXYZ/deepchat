import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, disposePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { GuidedOnboardingState } from '@shared/contracts/routes'
import { GUIDED_ONBOARDING_STEP_IDS, GUIDED_ONBOARDING_VERSION } from '@shared/guidedOnboarding'
import { settingsRouteComponents } from '../../../src/renderer/settings/settingsRouteComponents'
import { useAgentStore } from '@/stores/ui/agent'
import { useMcpStore } from '@/stores/mcp'

vi.unmock('pinia')
vi.unmock('vue-i18n')
vi.unmock('vue-router')

it.each(['settings', 'plugins'])(
  'keeps MCP, market and onboarding isolated in the %s host across reentry',
  async (entry) => {
    const pinia = createPinia()
    const agentStore = entry === 'plugins' ? useAgentStore(pinia) : null
    const selections = new Map<string, string[]>()
    let demoEnabled = true
    const listeners = new Map<string, Set<unknown>>()
    let onboardingState: GuidedOnboardingState = {
      version: GUIDED_ONBOARDING_VERSION,
      status: 'completed',
      startedAt: 0,
      completedAt: 1,
      lastActiveAt: 1,
      currentStepId: null,
      steps: GUIDED_ONBOARDING_STEP_IDS.map((id) => ({
        id,
        required: false,
        status: 'completed',
        startedAt: 0,
        completedAt: 1,
        skippedAt: null
      }))
    }
    const originalInvoke = vi.mocked(window.deepchat.invoke).getMockImplementation()!
    const invoke = vi.spyOn(window.deepchat, 'invoke').mockImplementation(async (name, input) => {
      switch (name) {
        case 'config.listAgents':
          return { agents: input.ids.map((id: string) => ({ id, type: 'deepchat' })) }
        case 'config.resolveDeepChatAgentConfig':
          return { config: { enabledMcpServerIds: selections.get(input.agentId) } }
        case 'config.updateDeepChatAgent':
          selections.set(input.agentId, input.updates.config.enabledMcpServerIds)
          return { agent: { id: input.agentId, type: 'deepchat', config: input.updates.config } }
        case 'onboarding.getState':
          return { state: onboardingState }
        case 'onboarding.setStepStatus':
          onboardingState = { ...onboardingState, currentStepId: 'skills' }
          return { state: onboardingState }
        case 'onboarding.start':
          onboardingState = { ...onboardingState, currentStepId: input.stepId }
          return { state: onboardingState }
        case 'onboarding.complete':
          onboardingState = { ...onboardingState, status: 'completed', currentStepId: null }
          return { state: onboardingState }
        case 'window.resumeGuidedOnboarding':
          return { requested: true, focused: true }
        case 'mcp.router.getApiKey':
          return { key: '' }
        case 'mcp.router.listServers':
          return { servers: [] }

        case 'mcp.getServers':
          return {
            servers: {
              demo: { type: 'stdio', command: 'demo', enabled: demoEnabled },
              offline: { type: 'stdio', command: 'offline', enabled: false },
              managed: { type: 'stdio', source: 'plugin', enabled: true }
            }
          }
        case 'mcp.setServerEnabled':
          demoEnabled = input.enabled
          return { enabled: demoEnabled }
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
        { path: '/away', component: { template: '<div />' } },
        ...(entry === 'plugins'
          ? [{ path: '/skills', name: 'plugins-skills', component: { template: '<div />' } }]
          : [{ path: '/provider', name: 'settings-provider', component: { template: '<div />' } }])
      ]
    })
    await router.push('/mcp?view=market&foo=1')
    await router.isReady()
    const i18n = createI18n({
      legacy: false,
      locale: 'en-US',
      missingWarn: false,
      fallbackWarn: false
    })
    const wrapper = mount(RouterView, {
      global: {
        plugins: [pinia, PiniaColada, router, i18n]
      }
    })
    try {
      await flushPromises()
      const clickButton = async (key: string) => {
        const button = wrapper.findAll('button').find((item) => item.text() === i18n.global.t(key))
        expect(button, key).toBeDefined()
        await button!.trigger('click')
        await flushPromises()
      }
      if (agentStore) {
        expect(wrapper.text()).toContain(i18n.global.t('dialog.agentTransfer.selectTarget'))
        expect(wrapper.find('[role="switch"]').exists()).toBe(false)
        expect(invoke).not.toHaveBeenCalledWith('config.listAgents', expect.anything())
        expect(agentStore.selectedAgentId).toBeNull()
        agentStore.setSelectedAgent('agent-a')
      } else {
        await vi.waitFor(() =>
          expect(wrapper.text()).toContain(i18n.global.t('mcp.market.builtinTitle'))
        )
        await clickButton('common.back')
        expect(router.currentRoute.value.query).toEqual({ foo: '1' })
      }
      await vi.waitFor(() => expect(wrapper.text()).toContain('demo'))
      const demoSwitch = () => wrapper.get('[role="switch"][aria-label="demo"]')
      if (agentStore) {
        expect(
          wrapper.get('[role="switch"][aria-label="offline"]').attributes('disabled')
        ).toBeDefined()
        for (const key of [
          'common.add',
          'routes.settings-mcp-market',
          'settings.mcp.npmRegistry.title'
        ]) {
          expect(wrapper.text()).not.toContain(i18n.global.t(key))
        }
        expect(wrapper.find('[aria-label$=": demo"]').exists()).toBe(false)
        await wrapper
          .findAll('h3')
          .find((heading) => heading.text() === 'demo')!
          .trigger('click')
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        await clickButton('settings.userPlugins.manageMcp')
        expect(invoke).toHaveBeenCalledWith('system.openSettings', { routeName: 'settings-mcp' })
        await demoSwitch().trigger('click')
        await flushPromises()
        expect(invoke).not.toHaveBeenCalledWith('mcp.setServerEnabled', expect.anything())
        expect(agentStore.selectedAgentId).toBe('agent-a')
        expect(selections.get('agent-a')).toEqual(['managed'])
        expect(demoSwitch().attributes('aria-checked')).toBe('false')
        selections.set('agent-b', ['demo', 'managed'])
        agentStore.setSelectedAgent('agent-b')
        await flushPromises()
        expect(demoSwitch().attributes('aria-checked')).toBe('true')
        const mcpStore = useMcpStore(pinia)
        demoEnabled = false
        await mcpStore.loadConfig({ force: true })
        await flushPromises()
        expect(demoSwitch().attributes('disabled')).toBeDefined()
        expect(demoSwitch().attributes('aria-checked')).toBe('false')
        demoEnabled = true
        await mcpStore.loadConfig({ force: true })
        await flushPromises()
        expect(demoSwitch().attributes('aria-checked')).toBe('true')
        expect(invoke).toHaveBeenCalledWith('config.updateDeepChatAgent', {
          agentId: 'agent-a',
          updates: { config: { enabledMcpServerIds: ['managed'] } }
        })
        expect(
          invoke.mock.calls.filter(([name]) => name === 'config.updateDeepChatAgent')
        ).toHaveLength(1)
        agentStore.setSelectedAgent('agent-a')
        await flushPromises()
        expect(demoSwitch().attributes('aria-checked')).toBe('false')
      } else {
        await demoSwitch().trigger('click')
        await flushPromises()
        expect(invoke).toHaveBeenCalledWith('mcp.setServerEnabled', {
          serverName: 'demo',
          enabled: false
        })
        expect(demoSwitch().attributes('aria-checked')).toBe('false')
        expect(selections.size).toBe(0)
        await clickButton('routes.settings-mcp-market')
        expect(router.currentRoute.value.query).toEqual({ foo: '1', view: 'market' })
        await clickButton('common.back')
        expect(router.currentRoute.value.name).toBe('settings-mcp')
        await vi.waitFor(() => expect(wrapper.text()).toContain('demo'))
      }
      const assertIsolated = () => {
        expect(pinia.state.value).not.toHaveProperty('session')
        expect(pinia.state.value).not.toHaveProperty('message')
        if (entry === 'settings') expect(pinia.state.value).not.toHaveProperty('agent')
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
      await vi.waitFor(() => expect(wrapper.text()).toContain('demo'))
      assertIsolated()
      for (const active of listeners.values()) expect(active.size).toBeLessThanOrEqual(1)
      expect(invoke).toHaveBeenCalledWith('mcp.getServers', {})

      for (const action of ['common.next', 'common.back', 'settings.skills.sync.skipAll']) {
        await router.push('/away')
        onboardingState = {
          ...onboardingState,
          status: 'active',
          currentStepId: 'mcp',
          steps: onboardingState.steps.map((step) => ({ ...step, status: 'pending' }))
        }
        await router.push('/mcp')
        await flushPromises()
        expect(wrapper.get('[data-testid="guided-onboarding-overlay"]').isVisible()).toBe(true)
        const previousHandoffs = invoke.mock.calls.filter(
          ([name]) => name === 'window.resumeGuidedOnboarding'
        ).length
        await clickButton(action)
        if (action === 'common.next' && entry === 'plugins') {
          expect(router.currentRoute.value.name).toBe('plugins-skills')
        } else if (action === 'common.back') {
          if (entry === 'settings') {
            expect(router.currentRoute.value.name).toBe('settings-provider')
          } else {
            expect(invoke).toHaveBeenCalledWith('system.openSettings', {
              routeName: 'settings-provider'
            })
          }
        } else {
          expect(
            invoke.mock.calls.filter(([name]) => name === 'window.resumeGuidedOnboarding')
          ).toHaveLength(previousHandoffs + 1)
        }
        assertIsolated()
      }
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
