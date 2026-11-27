import { flushPromises, mount } from '@vue/test-utils'
import katex from 'katex'
import NodeRenderer, { enableKatex, setKaTeXCache } from 'markstream-vue'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import {
  applyChatSearchHighlights,
  clearChatSearchHighlights,
  collectChatSearchResults,
  setActiveChatSearchResult
} from '@/lib/chatSearch'

async function expectSearchMatches(
  content: string,
  query: string,
  expectedTargets: string[],
  status: 'success' | 'loading' = 'success',
  expectedHeader?: string
) {
  const wrapper = mount(
    {
      render: () =>
        h('div', { 'data-message-id': 'message', class: 'markdown-renderer-root' }, [
          h(NodeRenderer, {
            content,
            final: status === 'success',
            mode: 'chat',
            htmlPolicy: 'safe',
            batchRendering: false,
            renderCodeBlocksAsPre: true
          })
        ])
    },
    { attachTo: document.body }
  )

  try {
    await wrapper.vm.$nextTick()
    await flushPromises()
    if (expectedHeader) {
      expect(wrapper.element.querySelector('.code-header-title')?.textContent).toBe(expectedHeader)
    }
    const results = collectChatSearchResults(
      [{ id: 'message', content: [{ type: 'content', content, status }] }],
      query
    )
    const marks = applyChatSearchHighlights(wrapper.element, query)
    expect(results).toHaveLength(expectedTargets.length)
    expect(marks).toHaveLength(expectedTargets.length)
    expectedTargets.forEach((selector, index) => {
      expect(marks[index].closest(selector)).not.toBeNull()
      expect(setActiveChatSearchResult(wrapper.element, results[index], { scroll: false })).toBe(
        marks[index]
      )
    })
  } finally {
    clearChatSearchHighlights(wrapper.element)
    wrapper.unmount()
  }
}

describe('chat search and rendered Markdown', () => {
  it('keeps HTML text, normal text, callout titles and footnotes in rendered order', async () => {
    const content = [
      'before <b title="hidden-marker">marker</b> and marker <span hidden>marker</span>[^1]',
      '',
      '::: warning marker',
      'marker',
      ':::',
      '',
      '[^1]: marker footnote'
    ].join('\n')
    await expectSearchMatches(content, 'marker', [
      'b',
      'p',
      '.admonition-title',
      '.admonition-content',
      '.footnote-node'
    ])
    await expectSearchMatches(content, 'hidden-marker', [])
  })

  it('ignores hidden block HTML and closed details without dropping visible text', async () => {
    const content = [
      '<div hidden>',
      '',
      'marker',
      '',
      '</div>',
      '',
      '<details>',
      '<summary>marker</summary>',
      '',
      'marker',
      '',
      '</details>',
      '',
      '<div>',
      '',
      'visible **marker**',
      '',
      '</div>'
    ].join('\n')
    await expectSearchMatches(content, 'marker', ['summary', 'strong'])
  })

  it('counts the visible math glyphs once and does not index the TeX command', async () => {
    const tex = 'x+\\alpha'
    // Markstream substitutes literal TeX for its math component under NODE_ENV=test.
    vi.stubEnv('NODE_ENV', 'development')
    try {
      enableKatex(() => katex)
      setKaTeXCache(tex, false, katex.renderToString(tex))
      await expectSearchMatches('before $x+\\alpha$ and x', 'x', [
        '[data-markstream-math] .katex-html',
        'p'
      ])
      await expectSearchMatches('before $x+\\alpha$ and x', 'x+α', ['[data-markstream-math]'])
      await expectSearchMatches('before $x+\\alpha$ and x', 'alpha', [])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('skips code-language labels before counting identical code and prose matches', async () => {
    const content = ['```typescript', 'const TypeScript = 1', '```', '', 'TypeScript'].join('\n')
    await expectSearchMatches(content, 'TypeScript', ['pre', 'p'], 'success', 'TypeScript')
  })

  it('uses the live parse, independently of a cached final parse of the same string', async () => {
    await expectSearchMatches('hello **wor', 'hello wor', [])
    await expectSearchMatches('hello **wor', 'hello wor', ['p'], 'loading')
    await expectSearchMatches('hello **wor', 'hello wor', [])
  })
})
