import { mount } from '@vue/test-utils'
import NodeRenderer from 'markstream-vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import LegacyArtifactSource from '@/components/message/LegacyArtifactSource.vue'
import { useBlockContent } from '@/composables/useArtifacts'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import {
  applyChatSearchHighlights,
  clearChatSearchHighlights,
  collectChatSearchResults,
  setActiveChatSearchResult
} from '@/lib/chatSearch'

vi.mock('@dc-ui/components', () => ({
  DcCopyButton: defineComponent(() => () => h('button', 'needle copy control'))
}))

describe('chat search and legacy artifacts', () => {
  it.each(['normalized block', 'legacy markup'])(
    'indexes literal title and source in visible order for a %s',
    async (shape) => {
      const title = 'needle title'
      const code = '<div>needle body</div>'
      const block: DisplayAssistantMessageBlock = {
        type: 'content',
        status: 'success',
        timestamp: 0,
        content:
          shape === 'normalized block'
            ? code
            : `<antArtifact identifier="hidden-id" title="${title}" type="text/html">${code}</antArtifact>`,
        ...(shape === 'normalized block'
          ? { artifact: { identifier: 'hidden-id', title, type: 'text/html' } }
          : {})
      }
      const prose: DisplayAssistantMessageBlock = {
        ...block,
        artifact: undefined,
        content: 'needle prose'
      }
      const message = { id: 'message', content: [block, prose] }
      const wrapper = mount(
        defineComponent(() => {
          const { processedContent } = useBlockContent({ block })
          return () =>
            h('div', { 'data-message-id': 'message' }, [
              ...processedContent.value.map((part) =>
                part.type === 'artifact' && part.artifact
                  ? h(LegacyArtifactSource, {
                      block: { content: part.content, artifact: part.artifact }
                    })
                  : null
              ),
              h('div', { class: 'markdown-renderer-root' }, [
                h(NodeRenderer, { content: prose.content, final: true, batchRendering: false })
              ])
            ])
        }),
        { attachTo: document.body }
      )

      try {
        await wrapper.vm.$nextTick()
        const root = wrapper.element
        const results = collectChatSearchResults([message], 'needle')
        const marks = applyChatSearchHighlights(root, 'needle')
        expect(results).toHaveLength(3)
        expect(marks.map((mark) => mark.parentElement?.textContent)).toEqual([
          title,
          code,
          'needle prose'
        ])
        results.forEach((result, index) => {
          expect(setActiveChatSearchResult(root, result, { scroll: false })).toBe(marks[index])
        })
        expect(collectChatSearchResults([message], code)).toHaveLength(1)
        expect(applyChatSearchHighlights(root, code)).toHaveLength(1)
        expect(collectChatSearchResults([message], 'hidden-id')).toHaveLength(0)
        expect(collectChatSearchResults([message], 'title <div>')).toHaveLength(0)
        expect(applyChatSearchHighlights(root, 'title <div>')).toHaveLength(0)
      } finally {
        clearChatSearchHighlights(wrapper.element)
        wrapper.unmount()
      }
    }
  )
})
