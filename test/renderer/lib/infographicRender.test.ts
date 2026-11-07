import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const renderedSources = vi.hoisted(() => [] as string[])

vi.mock('@antv/infographic', () => {
  class FakeInfographic {
    private container: HTMLElement
    constructor(options: { container: HTMLElement }) {
      this.container = options.container
    }
    on(): void {}
    render(source: string): void {
      renderedSources.push(source)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('data-testid', 'fake-infographic')
      this.container.appendChild(svg)
    }
    destroy(): void {}
  }
  return { Infographic: FakeInfographic, default: { Infographic: FakeInfographic } }
})

import '@/lib/markdownWorkerLifecycle'
import NodeRenderer from 'markstream-vue'

const source = [
  'infographic sequence-timeline-simple',
  'data',
  '  title Milestones',
  '  items',
  '    - label Build'
].join('\n')

describe('infographic code block', () => {
  it('renders through the registered @antv/infographic loader', async () => {
    const wrapper = mount(NodeRenderer, {
      props: { content: `\`\`\`infographic\n${source}\n\`\`\`\n`, final: true },
      attachTo: document.body
    })

    await vi.waitFor(() => expect(renderedSources).toEqual([`${source}\n`]))
    await flushPromises()
    expect(wrapper.find('[data-testid="fake-infographic"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
