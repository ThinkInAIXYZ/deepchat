import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import NotificationHost from '@renderer-notifications/NotificationHost.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('vue-sonner', () => ({
  Toaster: defineComponent({
    name: 'Toaster',
    props: [
      'theme',
      'dir',
      'position',
      'offset',
      'mobileOffset',
      'visibleToasts',
      'expand',
      'gap',
      'richColors',
      'closeButton',
      'containerAriaLabel',
      'style'
    ],
    template: '<div data-testid="toaster" />'
  })
}))

describe('NotificationHost', () => {
  it.each([
    ['main', 96],
    ['settings', 52]
  ] as const)('uses the %s surface offset and shared presentation limits', (surface, top) => {
    const wrapper = mount(NotificationHost, {
      props: {
        surface,
        theme: 'dark',
        dir: 'ltr'
      }
    })
    const toaster = wrapper.getComponent({ name: 'Toaster' })

    expect(toaster.props()).toMatchObject({
      theme: 'dark',
      dir: 'ltr',
      position: 'top-right',
      offset: { top, right: 16, left: 16 },
      mobileOffset: { top, right: 16, left: 16 },
      visibleToasts: 2,
      expand: true,
      gap: 10,
      richColors: true,
      closeButton: false,
      containerAriaLabel: 'common.notifications.label'
    })
    expect(toaster.props('style')).toMatchObject({
      '--error-bg': 'var(--dc-notification-error-bg)',
      zIndex: 'var(--dc-z-toast)'
    })
  })
})
