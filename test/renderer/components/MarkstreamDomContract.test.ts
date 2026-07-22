import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import NodeRenderer from 'markstream-vue'

const originalCssStyleSheet = globalThis.CSSStyleSheet
const originalResizeObserver = globalThis.ResizeObserver

beforeAll(() => {
  class TestCssStyleSheet {
    replaceSync() {}
  }

  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'CSSStyleSheet', {
    configurable: true,
    value: TestCssStyleSheet
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver
  })
})

afterAll(() => {
  Object.defineProperty(globalThis, 'CSSStyleSheet', {
    configurable: true,
    value: originalCssStyleSheet
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: originalResizeObserver
  })
})

async function settleRenderer() {
  await nextTick()
  await flushPromises()
  await nextTick()
  await flushPromises()
}

async function mountMarkstream(content: string) {
  const wrapper = mount(NodeRenderer, {
    props: {
      content,
      final: true,
      smoothStreaming: false,
      batchRendering: false,
      deferNodesUntilVisible: false,
      viewportPriority: false,
      nodeVirtual: false,
      codeRenderer: 'pre'
    }
  })
  await settleRenderer()
  return wrapper
}

describe('Markstream DOM contracts used by MarkdownRenderer delegation', () => {
  it.each([
    ['unlabeled', '```\nconst answer = 42', '```\nconst answer = 42\n```'],
    ['TypeScript', '```ts\nconst answer = 42', '```ts\nconst answer = 42\n```']
  ])(
    'keeps the %s fence readable through Markstream’s streaming-to-final handoff',
    async (_label, liveContent, finalContent) => {
      const wrapper = mount(NodeRenderer, {
        props: {
          content: liveContent,
          final: false,
          smoothStreaming: false,
          batchRendering: false,
          deferNodesUntilVisible: false,
          viewportPriority: false,
          nodeVirtual: false,
          codeRenderer: 'monaco',
          codeBlockStream: true
        }
      })

      await settleRenderer()

      expect(wrapper.get('pre.code-pre-fallback').text()).toContain('const answer = 42')

      await wrapper.setProps({
        content: finalContent,
        final: true,
        codeBlockStream: false
      })
      await settleRenderer()

      const codeBlock = wrapper.get('[data-markstream-code-block="1"]')
      expect(codeBlock.attributes('data-markstream-code-block-state')).toBe('settled')
      expect(codeBlock.text()).toContain('const answer = 42')
    }
  )

  it('updates the fallback text during streaming without replacing the renderer', async () => {
    const wrapper = mount(NodeRenderer, {
      props: {
        content: '```ts\nconst answer = 42',
        final: false,
        smoothStreaming: false,
        batchRendering: false,
        deferNodesUntilVisible: false,
        viewportPriority: false,
        nodeVirtual: false,
        codeRenderer: 'monaco',
        codeBlockStream: true
      }
    })

    await settleRenderer()
    const codeBlock = wrapper.get('[data-markstream-code-block="1"]').element

    await wrapper.setProps({ content: '```ts\nconst answer = 43' })
    await settleRenderer()

    expect(wrapper.get('[data-markstream-code-block="1"]').element).toBe(codeBlock)
    expect(wrapper.get('pre.code-pre-fallback').text()).toContain('const answer = 43')
  })

  it('marks both Markdown and normalized safe HTML links for delegation', async () => {
    const wrapper = await mountMarkstream(
      '[DeepChat](https://deepchat.thinkinai.xyz)\n\n<a href="https://example.com/raw">Raw</a>'
    )

    expect(wrapper.get('a.link-node').attributes('href')).toBe('https://deepchat.thinkinai.xyz')
    expect(wrapper.get('a[href="https://example.com/raw"]').classes()).toContain('link-node')
  })

  it('renders numeric citations with the reference-node delegation marker', async () => {
    const wrapper = await mountMarkstream('Cite research [1] for details.')
    const reference = wrapper.get('span.reference-node')

    expect(reference.text()).toBe('1')
    await reference.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })
})
