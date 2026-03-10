import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

describe('WelcomePage', () => {
  it('marks init complete and opens settings from the route welcome page', async () => {
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
    const windowPresenter = {
      openOrFocusSettingsWindow: vi.fn().mockResolvedValue(undefined)
    }

    ;(window as any).api = {
      getWindowId: vi.fn(() => 7)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'windowPresenter') return windowPresenter
        return {}
      }
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
      .find((button) => button.text().includes('Browse all providers'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')

    expect(configPresenter.setSetting).toHaveBeenCalledWith('init_complete', true)
    expect(pageRouter.goToNewThread).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'chat' })
    expect(windowPresenter.openOrFocusSettingsWindow).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no window id is available', async () => {
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
    const windowPresenter = {
      openOrFocusSettingsWindow: vi.fn().mockResolvedValue(undefined)
    }

    ;(window as any).api = {
      getWindowId: vi.fn(() => null)
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'configPresenter') return configPresenter
        if (name === 'windowPresenter') return windowPresenter
        return {}
      }
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
      .find((button) => button.text().includes('Browse all providers'))

    expect(browseButton).toBeDefined()

    await browseButton!.trigger('click')

    expect(configPresenter.setSetting).not.toHaveBeenCalled()
    expect(pageRouter.goToNewThread).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(windowPresenter.openOrFocusSettingsWindow).not.toHaveBeenCalled()
  })
})
