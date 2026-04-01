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

  it('renders command suggestions with a command icon instead of a slash tag', () => {
    const items: SuggestionListItem[] = [
      {
        id: 'command:plan',
        label: '/plan',
        category: 'command',
        payload: { name: 'plan', description: '', input: null }
      }
    ]

    const wrapper = mount(SuggestionList, {
      props: {
        items,
        query: '',
        command: vi.fn()
      }
    })

    expect(wrapper.find('[data-icon="lucide:command"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('/plan')
    expect(wrapper.text().match(/\//g) ?? []).toHaveLength(1)
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
