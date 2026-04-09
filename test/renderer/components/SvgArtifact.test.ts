import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SvgArtifact from '@/components/artifacts/SvgArtifact.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    sanitizeSvgContent: vi.fn(async (content: string) => content)
  })
}))

describe('SvgArtifact', () => {
  it('uses full-height flex classes for sanitized previews', async () => {
    const wrapper = mount(SvgArtifact, {
      props: {
        block: {
          content: '<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>',
          artifact: { type: 'image/svg+xml', title: 'Diagram' }
        }
      }
    })

    await flushPromises()

    expect(wrapper.get('[data-testid="svg-artifact-root"]').classes()).toEqual(
      expect.arrayContaining([
        'artifact-dialog-content',
        'flex',
        'h-full',
        'min-h-0',
        'w-full',
        'overflow-auto'
      ])
    )
    expect(wrapper.get('[data-testid="svg-artifact-content"]').classes()).toEqual(
      expect.arrayContaining([
        'flex',
        'min-h-full',
        'w-full',
        'flex-1',
        'items-center',
        'justify-center'
      ])
    )
  })
})
