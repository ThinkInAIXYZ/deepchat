import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReactArtifact from '@/components/artifacts/ReactArtifact.vue'

describe('ReactArtifact', () => {
  it('uses full-height iframe classes without fixed minimum height', () => {
    const wrapper = mount(ReactArtifact, {
      props: {
        block: {
          content: 'export default function App() { return <div>Hello</div> }',
          artifact: { type: 'application/vnd.ant.react', title: 'App' }
        },
        isPreview: true
      },
      attachTo: document.body
    })

    expect(wrapper.get('[data-testid="react-artifact-root"]').classes()).toEqual(
      expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'w-full', 'overflow-hidden'])
    )

    const iframe = wrapper.get('[data-testid="react-artifact-iframe"]')
    expect(iframe.classes()).toEqual(
      expect.arrayContaining(['html-iframe-wrapper', 'h-full', 'min-h-0', 'w-full'])
    )
    expect(iframe.attributes('class')).not.toContain('min-h-[400px]')
  })
})
