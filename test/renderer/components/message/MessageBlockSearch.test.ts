import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageBlockSearch from '@/components/message/MessageBlockSearch.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

const navigateLink = vi.hoisted(() =>
  vi.fn().mockImplementation((_url: string, event?: MouseEvent) => {
    event?.preventDefault()
    return Promise.resolve(true)
  })
)

vi.mock('@/components/markdown/useMarkdownLinkNavigation', () => ({
  useMarkdownLinkNavigation: () => ({ navigateLink })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: unknown[]) => {
      if (key === 'chat.features.webSearch') return 'Web Search'
      if (key === 'chat.search.results') return `Found ${params?.[0]} web pages`
      if (key === 'chat.search.searching') return 'Searching...'
      if (key === 'chat.search.error') return 'Search failed'
      return key
    }
  })
}))

const mountSearch = (block: DisplayAssistantMessageBlock) =>
  mount(MessageBlockSearch, {
    props: { block, threadId: 's1' },
    global: {
      stubs: {
        Icon: defineComponent({
          name: 'Icon',
          props: { icon: { type: String, required: true } },
          template: '<span data-testid="icon" :data-icon="icon" />'
        })
      }
    }
  })

describe('MessageBlockSearch', () => {
  beforeEach(() => {
    navigateLink.mockClear()
  })

  it('renders normalized provider sources and filters unsafe URLs', async () => {
    const wrapper = mountSearch({
      id: 'ws_1',
      type: 'search',
      content: 'DeepChat latest release',
      status: 'success',
      timestamp: 1,
      extra: {
        total: 3,
        pages: [
          { title: 'DeepChat', url: 'https://deepchat.thinkinai.xyz/' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
          { title: 'Credentials', url: 'https://user:secret@example.com/private' }
        ]
      }
    })

    expect(wrapper.text()).toContain('DeepChat latest release')
    expect(wrapper.text()).toContain('Found 3 web pages')
    expect(wrapper.findAll('[data-testid="search-source-link"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="icon"]').attributes('data-icon')).toBe('lucide:globe-2')

    await wrapper.get('[data-testid="search-source-link"]').trigger('click')
    expect(navigateLink).toHaveBeenCalledWith('https://deepchat.thinkinai.xyz/', expect.anything())
  })

  it('wraps a completed search target instead of truncating it', () => {
    const target =
      '今日金价 2026年8月6日, gold price today August 6 2026, 国内金价 今日 上海黄金交易所'
    const wrapper = mountSearch({
      id: 'ws_1',
      type: 'search',
      content: target,
      status: 'success',
      timestamp: 1,
      extra: { actionType: 'search' }
    })

    const targetElement = wrapper.get('[data-testid="search-action-text"]')
    expect(targetElement.text()).toBe(target)
    expect(targetElement.classes()).toContain('break-words')
    expect(targetElement.classes()).not.toContain('truncate')
  })

  it('shows an open-page target without claiming that zero results were found', async () => {
    const wrapper = mountSearch({
      id: 'ws_page_1',
      type: 'search',
      content: 'https://example.com/current-price',
      status: 'success',
      timestamp: 1,
      extra: {
        total: 0,
        actionType: 'open_page',
        actionUrl: 'https://example.com/current-price',
        pages: [],
        providerReplayJson: '{"opaque":true}'
      }
    })

    expect(wrapper.get('[data-testid="search-action-link"]').attributes('href')).toBe(
      'https://example.com/current-price'
    )
    expect(wrapper.get('[data-testid="icon"]').attributes('data-icon')).toBe('lucide:external-link')
    expect(wrapper.text()).not.toContain('Found 0')
    expect(wrapper.text()).not.toContain('opaque')

    await wrapper.get('[data-testid="search-action-link"]').trigger('click')
    expect(navigateLink).toHaveBeenCalledWith(
      'https://example.com/current-price',
      expect.anything()
    )
  })

  it('keeps a find pattern separate from its page navigation link', async () => {
    const wrapper = mountSearch({
      id: 'ws_find_1',
      type: 'search',
      content: 'current price',
      status: 'success',
      timestamp: 1,
      extra: {
        actionType: 'find_in_page',
        actionUrl: 'https://example.com/article'
      }
    })

    expect(wrapper.get('[data-testid="icon"]').attributes('data-icon')).toBe('lucide:search')
    expect(wrapper.get('[data-testid="search-action-text"]').text()).toBe('current price')
    expect(wrapper.find('[data-testid="search-action-link"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="search-find-page-link"]').text()).toBe('example.com')

    await wrapper.get('[data-testid="search-find-page-link"]').trigger('click')
    expect(navigateLink).toHaveBeenCalledWith('https://example.com/article', expect.anything())
  })

  it('does not make a credential-bearing action URL interactive', () => {
    const wrapper = mountSearch({
      id: 'ws_page_unsafe',
      type: 'search',
      content: '',
      status: 'success',
      timestamp: 1,
      extra: {
        actionType: 'open_page',
        actionUrl: 'https://user:secret@example.com/private'
      }
    })

    expect(wrapper.find('[data-testid="search-action-link"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Web Search')
  })

  it('does not make oversized legacy URLs interactive or render them as sources', () => {
    const oversizedUrl = `https://example.com/${'x'.repeat(9000)}`
    const wrapper = mountSearch({
      id: 'ws_page_oversized',
      type: 'search',
      content: oversizedUrl,
      status: 'success',
      timestamp: 1,
      extra: {
        actionType: 'open_page',
        actionUrl: oversizedUrl,
        pages: [{ title: 'Oversized', url: oversizedUrl }]
      }
    })

    expect(wrapper.find('[data-testid="search-action-link"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="search-source-link"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(oversizedUrl)
  })
})
