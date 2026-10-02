import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReleaseNotes from '../../../src/renderer/settings/components/ReleaseNotes.vue'

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@api/BrowserClient', () => ({
  createBrowserClient: () => ({ openExternal })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ isDark: false })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: () => 'Release Notes' })
}))

const releaseUrl = 'https://github.com/ThinkInAIXYZ/deepchat/releases/tag/v1.1.3'
const markdown = `## Changes

- **Fixed** update notes
- 修复日志中的 \`Markdown\` 排版

[Details](/ThinkInAIXYZ/deepchat/pull/123)
`
const atomHtml = `<h2>Changes</h2>
<ul>
<li><strong>Fixed</strong> update notes</li>
<li>修复日志中的 <code>Markdown</code> 排版</li>
</ul>
<p><a href="/ThinkInAIXYZ/deepchat/pull/123">Details</a></p>`

const renderNotes = async (content: string) => {
  const wrapper = mount(ReleaseNotes, { props: { content, releaseUrl } })
  await flushPromises()
  return wrapper
}

describe('ReleaseNotes with the real Markdown renderer', () => {
  beforeEach(() => {
    openExternal.mockClear()
  })

  it.each([markdown, atomHtml])(
    'renders structured notes and opens release-relative links',
    async (content) => {
      const wrapper = await renderNotes(content)

      expect(wrapper.get('h2').text()).toBe('Changes')
      expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
        'Fixed update notes',
        '修复日志中的 Markdown 排版'
      ])
      expect(wrapper.get('strong').text()).toBe('Fixed')
      expect(wrapper.get('code').text()).toBe('Markdown')
      expect(wrapper.attributes('aria-label')).toBe('Release Notes')
      expect(wrapper.attributes('tabindex')).toBe('0')

      const preventDefault = vi.spyOn(Event.prototype, 'preventDefault')
      await wrapper.get('a').trigger('click')

      expect(preventDefault).toHaveBeenCalled()
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(
        'https://github.com/ThinkInAIXYZ/deepchat/pull/123'
      )
    }
  )

  it('replaces old notes completely when a different release arrives', async () => {
    const wrapper = await renderNotes(atomHtml)
    await wrapper.setProps({ content: '## 新版本\n\n1. 唯一的新条目' })
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('新版本')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['唯一的新条目'])
    expect(wrapper.text()).not.toContain('Fixed')
  })

  it('keeps code samples inert and strips active HTML while preserving safe content', async () => {
    const wrapper = await renderNotes(`<h2>Safe heading</h2>
<p><a href="https://example.com/notes" onclick="alert(1)">Safe link</a></p>
<script>alert(1)</script>
<iframe src="https://example.com"></iframe>
<p><a href="javascript:alert(1)">Unsafe link</a></p>

\`\`\`html
<script>codeSample()</script>
\`\`\``)

    expect(wrapper.get('h2').text()).toBe('Safe heading')
    expect(wrapper.get('a[href="https://example.com/notes"]').text()).toBe('Safe link')
    expect(wrapper.get('pre').text()).toContain('<script>codeSample()</script>')
    expect(wrapper.find('script, iframe, [onclick], a[href^="javascript:"]').exists()).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('handles nested link targets and middle clicks without navigating the settings window', async () => {
    const wrapper = await renderNotes(
      '<p><a href="https://example.com/notes"><strong>Read more</strong></a></p>'
    )
    const preventDefault = vi.spyOn(Event.prototype, 'preventDefault')
    await wrapper.get('strong').trigger('auxclick', { button: 1, bubbles: true, cancelable: true })

    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/notes')
  })

  it('opens absolute links without release metadata but never resolves relative links to the app', async () => {
    const wrapper = mount(ReleaseNotes, {
      props: {
        content:
          '<p><a href="https://example.com/notes">Absolute</a> <a href="/notes">Relative</a></p>'
      }
    })
    await flushPromises()
    await wrapper.get('a[href="https://example.com/notes"]').trigger('click')
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/notes')

    openExternal.mockClear()
    const preventDefault = vi.spyOn(Event.prototype, 'preventDefault')
    await wrapper.get('a[href="/notes"]').trigger('click')
    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('does not launch non-web protocols from release content', async () => {
    const wrapper = await renderNotes('<p><a href="mailto:someone@example.com">Contact</a></p>')
    const preventDefault = vi.spyOn(Event.prototype, 'preventDefault')
    await wrapper.get('a').trigger('click')

    expect(preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
