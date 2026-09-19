import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import MarkdownArtifact from '@/components/artifacts/MarkdownArtifact.vue'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

describe('MarkdownArtifact', () => {
  it('renders artifact markdown as completed non-virtualized content', () => {
    const wrapper = mount(MarkdownArtifact, {
      props: {
        block: {
          artifact: {
            type: 'text/markdown',
            title: 'Readme'
          },
          content: '# Artifact'
        }
      },
      global: {
        stubs: {
          MarkdownRenderer: defineComponent({
            name: 'MarkdownRenderer',
            props: {
              content: {
                type: String,
                required: true
              },
              final: {
                type: Boolean,
                default: undefined
              },
              smoothStreaming: {
                type: Boolean,
                default: true
              },
              virtualizeNodes: {
                type: Boolean,
                default: true
              },
              linkContext: {
                type: Object as () => MarkdownLinkContext | undefined,
                default: undefined
              }
            },
            template:
              '<div data-testid="markdown-renderer" :data-final="String(final)" :data-smooth-streaming="String(smoothStreaming)" :data-virtualize-nodes="String(virtualizeNodes)" :data-link-source="linkContext?.source">{{ content }}</div>'
          })
        }
      }
    })

    const renderer = wrapper.get('[data-testid="markdown-renderer"]')
    expect(renderer.text()).toContain('# Artifact')
    expect(renderer.attributes('data-final')).toBe('true')
    expect(renderer.attributes('data-smooth-streaming')).toBe('false')
    expect(renderer.attributes('data-virtualize-nodes')).toBe('false')
    expect(renderer.attributes('data-link-source')).toBe('artifact')
  })
})
