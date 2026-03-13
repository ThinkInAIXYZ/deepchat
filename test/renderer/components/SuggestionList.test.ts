import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { SuggestionListItem } from '@/components/chat/mentions/SuggestionList.vue'
import SuggestionList from '@/components/chat/mentions/SuggestionList.vue'

const buildItems = (count: number): SuggestionListItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `tool:${index + 1}`,
    label: `tool-${index + 1}`,
    category: 'tool',
    payload: { id: index + 1 }
  }))

describe('SuggestionList', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('renders the full upstream item list without truncating', () => {
    const items = buildItems(25)

    const wrapper = mount(SuggestionList, {
      props: {
        items,
        query: '',
        command: vi.fn()
      }
    })

    expect(wrapper.findAll('button')).toHaveLength(25)
    expect(wrapper.text()).toContain('tool-25')
  })

  it('keeps keyboard navigation aligned with the full item list', () => {
    const items = buildItems(25)
    const command = vi.fn()

    const wrapper = mount(SuggestionList, {
      props: {
        items,
        query: '',
        command
      }
    })

    ;(wrapper.vm as any).onKeyDown({ event: new KeyboardEvent('keydown', { key: 'ArrowUp' }) })
    ;(wrapper.vm as any).onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Enter' }) })

    expect(command).toHaveBeenCalledWith(items[24])
  })
})
