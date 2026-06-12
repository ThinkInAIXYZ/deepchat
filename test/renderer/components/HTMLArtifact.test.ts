import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import HTMLArtifact from '@/components/artifacts/HTMLArtifact.vue'

describe('HTMLArtifact', () => {
  it('uses full-height classes for desktop viewport', () => {
    const wrapper = mount(HTMLArtifact, {
      props: {
        block: {
          content: '<html><body>Hello</body></html>',
          artifact: { type: 'text/html', title: 'doc' }
        },
        isPreview: true,
        viewportSize: 'desktop'
      },
      attachTo: document.body
    })

    expect(wrapper.get('[data-testid="html-artifact-root"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'w-full', 'overflow-hidden'])
    )
    expect(wrapper.get('[data-testid="html-artifact-iframe"]').classes()).toEqual(
      expect.arrayContaining(['block', 'h-full', 'min-h-0', 'w-full'])
    )
  })

  it('applies correct classes and styles for mobile viewport', () => {
    const wrapper = mount(HTMLArtifact, {
      props: {
        block: {
          content: '<html><body>Hello</body></html>',
          artifact: { type: 'text/html', title: 'doc' }
        },
        isPreview: true,
        viewportSize: 'mobile'
      },
      attachTo: document.body
    })

    const iframe = wrapper.get('[data-testid="html-artifact-iframe"]')
    expect(iframe.exists()).toBe(true)
    const cls = iframe.attributes('class') || ''
    expect(cls).toContain('html-iframe-wrapper')
    expect(cls).toContain('border')

    const style = iframe.attributes('style') || ''
    expect(style).toContain('width: 375px')
    expect(style).toContain('height: 667px')
  })
})
