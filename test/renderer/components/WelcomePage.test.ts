import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
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
    vi.doMock('@api/ConfigClient', () => ({
      ConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
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

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.browseProviders'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')
    await vi.runAllTimersAsync()

    expect(configPresenter.setSetting).toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-provider' })
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
    vi.doMock('@api/ConfigClient', () => ({
      ConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
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

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.acpTitle'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')
    await vi.runAllTimersAsync()

    expect(configPresenter.setSetting).toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
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

    vi.doMock('@api/ConfigClient', () => ({
      ConfigClient: vi.fn(() => ({
        setSetting: configPresenter.setSetting,
        openSettings
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

    const browseButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('welcome.page.browseProviders'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')

    expect(configPresenter.setSetting).toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalledWith({ routeName: 'settings-provider' })
  })
})
