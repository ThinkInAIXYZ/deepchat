import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { GUIDED_ONBOARDING_RESUME_STORAGE_KEY } from '@/lib/onboardingResume'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  window.sessionStorage.removeItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)
})

describe('WelcomePage', () => {
  it('marks init complete and navigates provider entry to provider settings', async () => {
    vi.resetModules()
    vi.useFakeTimers()

    const router = {
      replace: vi.fn().mockResolvedValue(undefined)
    }
    const pageRouter = {
      goToNewThread: vi.fn()
    }
    const configPresenter = {
      setSetting: vi.fn().mockResolvedValue(undefined)
    }
    const openSettings = vi.fn().mockResolvedValue(undefined)
    const onboardingSetStepStatus = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'provider-api-key'
    })
    const onboardingStart = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })
    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
      }))
    }))
    vi.doMock('@api/OnboardingClient', () => ({
      createOnboardingClient: vi.fn(() => ({
        getState: vi.fn().mockResolvedValue({
          version: 4,
          status: 'active',
          startedAt: 1,
          completedAt: null,
          lastActiveAt: 1,
          currentStepId: 'select-provider',
          steps: [
            {
              id: 'select-provider',
              required: true,
              status: 'in_progress',
              startedAt: 1,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-api-key',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-model',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'mcp',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'skills',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-agent',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-model',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'first-chat',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            }
          ]
        }),
        start: onboardingStart,
        setStepStatus: onboardingSetStepStatus
      }))
    }))
    vi.doMock('@/stores/ui/pageRouter', () => ({
      usePageRouterStore: () => pageRouter
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({
        isDark: false
      })
    }))
    vi.doMock('@/components/icons/ModelIcon.vue', () => ({
      default: {
        name: 'ModelIcon',
        template: '<span />'
      }
    }))
    vi.doMock('vue-router', async () => {
      const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
      return {
        ...actual,
        useRoute: () => ({
          name: 'welcome'
        }),
        useRouter: () => router
      }
    })
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const WelcomePage = (await import('@/pages/WelcomePage.vue')).default

    const wrapper = mount(WelcomePage, {
      global: {
        stubs: {
          Icon: true
        }
      }
    })
    await flushPromises()

    const guideImportButton = wrapper.find('[data-testid="welcome-guide-import-action"]')
    expect(guideImportButton.exists()).toBe(true)
    expect(wrapper.get('[data-testid="welcome-guide-panel"]').text()).toContain(
      'welcome.page.guide.or'
    )
    expect(wrapper.get('[data-testid="welcome-guide-panel"]').text()).toContain(
      'welcome.page.importProviders'
    )
    expect(wrapper.find('[data-testid="welcome-provider-import-action"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="welcome-provider-grid"]').text()).not.toContain(
      'welcome.page.importProviders'
    )

    await guideImportButton.trigger('click')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(onboardingSetStepStatus).not.toHaveBeenCalled()
    expect(onboardingStart).toHaveBeenCalledWith({ stepId: 'provider-api-key' })
    expect(openSettings).toHaveBeenCalledWith({
      routeName: 'settings-database',
      section: 'provider-import'
    })
    expect(
      JSON.parse(window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY) ?? '{}')
    ).toMatchObject({
      stepId: 'provider-api-key',
      trigger: 'window-focus'
    })

    onboardingStart.mockClear()
    openSettings.mockClear()
    window.sessionStorage.removeItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.browseProviders'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(onboardingSetStepStatus).not.toHaveBeenCalled()
    expect(onboardingStart).toHaveBeenCalledWith({ stepId: 'select-provider' })
    expect(configPresenter.setSetting).not.toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-provider' })
    expect(
      JSON.parse(window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY) ?? '{}')
    ).toMatchObject({
      stepId: 'select-provider',
      trigger: 'window-focus'
    })
  })

  it('navigates the ACP entry to ACP settings', async () => {
    vi.resetModules()
    vi.useFakeTimers()

    const router = {
      replace: vi.fn().mockResolvedValue(undefined)
    }
    const pageRouter = {
      goToNewThread: vi.fn()
    }
    const configPresenter = {
      setSetting: vi.fn().mockResolvedValue(undefined)
    }
    const openSettings = vi.fn().mockResolvedValue(undefined)
    const onboardingSetStepStatus = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })
    const onboardingStart = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })
    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
      }))
    }))
    vi.doMock('@api/OnboardingClient', () => ({
      createOnboardingClient: vi.fn(() => ({
        getState: vi.fn().mockResolvedValue({
          version: 4,
          status: 'active',
          startedAt: 1,
          completedAt: null,
          lastActiveAt: 1,
          currentStepId: 'select-provider',
          steps: [
            {
              id: 'select-provider',
              required: true,
              status: 'in_progress',
              startedAt: 1,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-api-key',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-model',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'mcp',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'skills',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-agent',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-model',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'first-chat',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            }
          ]
        }),
        start: onboardingStart,
        setStepStatus: onboardingSetStepStatus
      }))
    }))
    vi.doMock('@/stores/ui/pageRouter', () => ({
      usePageRouterStore: () => pageRouter
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({
        isDark: false
      })
    }))
    vi.doMock('@/components/icons/ModelIcon.vue', () => ({
      default: {
        name: 'ModelIcon',
        template: '<span />'
      }
    }))
    vi.doMock('vue-router', async () => {
      const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
      return {
        ...actual,
        useRoute: () => ({
          name: 'welcome'
        }),
        useRouter: () => router
      }
    })
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const WelcomePage = (await import('@/pages/WelcomePage.vue')).default

    const wrapper = mount(WelcomePage, {
      global: {
        stubs: {
          Icon: true
        }
      }
    })
    await flushPromises()

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.acpTitle'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(onboardingStart).not.toHaveBeenCalledWith({ stepId: 'provider' })
    expect(configPresenter.setSetting).not.toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-acp' })
  })

  it('opens settings without redirect when already outside the welcome route', async () => {
    vi.resetModules()

    const router = {
      replace: vi.fn().mockResolvedValue(undefined)
    }
    const pageRouter = {
      goToNewThread: vi.fn()
    }
    const configPresenter = {
      setSetting: vi.fn().mockResolvedValue(undefined)
    }
    const openSettings = vi.fn().mockResolvedValue(undefined)
    const onboardingSetStepStatus = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })
    const onboardingStart = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
      }))
    }))
    vi.doMock('@api/OnboardingClient', () => ({
      createOnboardingClient: vi.fn(() => ({
        getState: vi.fn().mockResolvedValue({
          version: 4,
          status: 'active',
          startedAt: 1,
          completedAt: null,
          lastActiveAt: 1,
          currentStepId: 'select-provider',
          steps: [
            {
              id: 'select-provider',
              required: true,
              status: 'in_progress',
              startedAt: 1,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-api-key',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-model',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'mcp',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'skills',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-agent',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-model',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'first-chat',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            }
          ]
        }),
        start: onboardingStart,
        setStepStatus: onboardingSetStepStatus
      }))
    }))
    vi.doMock('@/stores/ui/pageRouter', () => ({
      usePageRouterStore: () => pageRouter
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({
        isDark: false
      })
    }))
    vi.doMock('@/components/icons/ModelIcon.vue', () => ({
      default: {
        name: 'ModelIcon',
        template: '<span />'
      }
    }))
    vi.doMock('vue-router', async () => {
      const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
      return {
        ...actual,
        useRoute: () => ({
          name: 'chat'
        }),
        useRouter: () => router
      }
    })
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const WelcomePage = (await import('@/pages/WelcomePage.vue')).default

    const wrapper = mount(WelcomePage, {
      global: {
        stubs: {
          Icon: true
        }
      }
    })
    await flushPromises()

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.browseProviders'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')
    await flushPromises()

    expect(onboardingSetStepStatus).not.toHaveBeenCalled()
    expect(onboardingStart).toHaveBeenCalledWith({ stepId: 'select-provider' })
    expect(configPresenter.setSetting).not.toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-provider' })
  })

  it('uses the primary onboarding action to resume the first chat step', async () => {
    vi.resetModules()

    const router = {
      replace: vi.fn().mockResolvedValue(undefined)
    }
    const pageRouter = {
      goToNewThread: vi.fn()
    }
    const openSettings = vi.fn().mockResolvedValue(undefined)
    const onboardingStart = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'first-chat'
    })

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: vi.fn(() => ({
        openSettings
      }))
    }))
    vi.doMock('@api/OnboardingClient', () => ({
      createOnboardingClient: vi.fn(() => ({
        getState: vi.fn().mockResolvedValue({
          version: 1,
          status: 'active',
          startedAt: 1,
          completedAt: null,
          lastActiveAt: 1,
          currentStepId: 'first-chat',
          steps: [
            {
              id: 'provider',
              required: true,
              status: 'completed',
              startedAt: 1,
              completedAt: 2,
              skippedAt: null
            },
            {
              id: 'first-chat',
              required: true,
              status: 'in_progress',
              startedAt: 3,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-model',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'mcp',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'skills',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'plugins',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            }
          ]
        }),
        start: onboardingStart
      }))
    }))
    vi.doMock('@/stores/ui/pageRouter', () => ({
      usePageRouterStore: () => pageRouter
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({
        isDark: false
      })
    }))
    vi.doMock('@/components/icons/ModelIcon.vue', () => ({
      default: {
        name: 'ModelIcon',
        template: '<span />'
      }
    }))
    vi.doMock('vue-router', async () => {
      const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
      return {
        ...actual,
        useRoute: () => ({
          name: 'welcome'
        }),
        useRouter: () => router
      }
    })
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const WelcomePage = (await import('@/pages/WelcomePage.vue')).default

    const wrapper = mount(WelcomePage, {
      global: {
        stubs: {
          Icon: true
        }
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="welcome-guide-primary-action"]').trigger('click')

    expect(onboardingStart).toHaveBeenCalledWith({ stepId: 'first-chat' })
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
    expect(openSettings).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)).toBeNull()
  })

  it('blocks background clicks and lets the spotlight coachmark continue the real select-provider step', async () => {
    vi.resetModules()

    const router = {
      replace: vi.fn().mockResolvedValue(undefined)
    }
    const pageRouter = {
      goToNewThread: vi.fn()
    }
    const openSettings = vi.fn().mockResolvedValue(undefined)
    const onboardingSetStepStatus = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'select-provider'
    })
    const onboardingStart = vi.fn().mockResolvedValue({
      status: 'active',
      currentStepId: 'first-chat'
    })

    vi.doMock('@api/ConfigClient', () => ({
      createConfigClient: vi.fn(() => ({
        openSettings
      }))
    }))
    vi.doMock('@api/OnboardingClient', () => ({
      createOnboardingClient: vi.fn(() => ({
        getState: vi.fn().mockResolvedValue({
          version: 4,
          status: 'active',
          startedAt: 1,
          completedAt: null,
          lastActiveAt: 1,
          currentStepId: 'select-provider',
          steps: [
            {
              id: 'select-provider',
              required: true,
              status: 'in_progress',
              startedAt: 1,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-api-key',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'provider-model',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'mcp',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'skills',
              required: false,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-agent',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'switch-model',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            },
            {
              id: 'first-chat',
              required: true,
              status: 'pending',
              startedAt: null,
              completedAt: null,
              skippedAt: null
            }
          ]
        }),
        start: onboardingStart,
        setStepStatus: onboardingSetStepStatus
      }))
    }))
    vi.doMock('@/stores/ui/pageRouter', () => ({
      usePageRouterStore: () => pageRouter
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/stores/theme', () => ({
      useThemeStore: () => ({
        isDark: false
      })
    }))
    vi.doMock('@/components/icons/ModelIcon.vue', () => ({
      default: {
        name: 'ModelIcon',
        template: '<span />'
      }
    }))
    vi.doMock('vue-router', async () => {
      const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
      return {
        ...actual,
        useRoute: () => ({
          name: 'welcome'
        }),
        useRouter: () => router
      }
    })
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const WelcomePage = (await import('@/pages/WelcomePage.vue')).default

    const wrapper = mount(WelcomePage, {
      global: {
        stubs: {
          Icon: true
        }
      }
    })
    await flushPromises()

    const coachmark = wrapper.get('[data-testid="welcome-guide-coachmark"]')
    expect(coachmark.attributes('data-guide-target')).toBe('providers')
    expect(coachmark.text()).toContain('welcome.page.guide.title')

    await wrapper.get('[data-testid="welcome-guide-blocker"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="welcome-guide-coachmark"]').exists()).toBe(true)
    expect(openSettings).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()

    expect(wrapper.find('[data-testid="welcome-guide-next-action"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="welcome-guide-coachmark-primary-action"]').exists()).toBe(
      false
    )
    expect(wrapper.find('[data-testid="welcome-guide-import-action"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="welcome-provider-import-action"]').exists()).toBe(false)

    await wrapper.get('[data-testid="welcome-guide-next-action"]').trigger('click')
    await flushPromises()

    expect(onboardingSetStepStatus).not.toHaveBeenCalled()
    expect(onboardingStart).toHaveBeenCalledWith({ stepId: 'select-provider' })
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-provider' })
    expect(onboardingStart).not.toHaveBeenCalledWith({ stepId: 'first-chat' })
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalledWith({ name: 'chat' })
  })
})
