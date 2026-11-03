import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, disposePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { GuidedOnboardingState } from '@shared/contracts/routes'
import { GUIDED_ONBOARDING_STEP_IDS, GUIDED_ONBOARDING_VERSION } from '@shared/guidedOnboarding'
import { settingsRouteComponents } from '../../../src/renderer/settings/settingsRouteComponents'

vi.unmock('pinia')
vi.unmock('vue-i18n')
vi.unmock('vue-router')

it.each(['settings', 'plugins'])(
  'keeps MCP, market and onboarding isolated in the %s host across reentry',
  async (entry) => {
    const pinia = createPinia()
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
      await vi.waitFor(() =>
        expect(wrapper.text()).toContain(i18n.global.t('mcp.market.builtinTitle'))
      )
      await clickButton('common.back')
      expect(router.currentRoute.value.query).toEqual({ foo: '1' })
      await vi.waitFor(() => expect(wrapper.text()).toContain('demo'))
      await clickButton('routes.settings-mcp-market')
      expect(router.currentRoute.value.query).toEqual({ foo: '1', view: 'market' })
      await clickButton('common.back')
      expect(router.currentRoute.value.name).toBe(`${entry}-mcp`)
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
