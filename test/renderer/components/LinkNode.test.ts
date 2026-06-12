import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownLinkContext } from '@/components/markdown/linkTypes'

describe('LinkNode', () => {
  const setup = async (options: { href: string; linkContext?: MarkdownLinkContext }) => {
    vi.resetModules()

    const sidepanelStore = {
      openBrowser: vi.fn(),
      selectFile: vi.fn()
    }

    const sessionStore = {
      sessions: [
        {
          id: 'session-1',
          projectDir: '/repo'
        }
      ],
      activeSessionId: 'session-1',
      activeSession: {
        id: 'session-1',
        projectDir: '/repo'
      }
    }

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    vi.doMock('@/stores/ui/session', () => ({
      useSessionStore: () => sessionStore
    }))

    vi.doMock('@api/legacy/presenters', () => ({
      useLegacyPresenter: () => ({})
    }))

    const LinkNode = (await import('@/components/markdown/LinkNode.vue')).default
    const wrapper = mount(LinkNode, {
      props: {
        node: {
          href: options.href
        },
        linkContext:
          options.linkContext ??
          ({
            source: 'chat',
            sessionId: 'session-1'
          } satisfies MarkdownLinkContext)
      },
      slots: {
        default: 'Open link'
      }
    })

    return {
      wrapper,
      sidepanelStore,
      sessionStore
    }
  }

  beforeEach(() => {
    window.api = {
      ...window.api,
      openExternal: vi.fn().mockResolvedValue(undefined)
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens http links in YoBrowser by default', async () => {
    const { wrapper, sidepanelStore } = await setup({
      href: 'https://example.com'
    })

    await wrapper.get('a').trigger('click')

    expect(sidepanelStore.openBrowser).toHaveBeenCalledTimes(1)
    expect(window.deepchat.invoke).toHaveBeenCalledWith(
      'browser.loadUrl',
      expect.objectContaining({
        sessionId: 'session-1',
        url: 'https://example.com'
      })
    )
    expect(window.api.openExternal).not.toHaveBeenCalled()
  })

  it('falls back to node text when markstream does not provide a slot', async () => {
    vi.resetModules()

    const sidepanelStore = {
      openBrowser: vi.fn(),
      selectFile: vi.fn()
    }

    vi.doMock('@/stores/ui/sidepanel', () => ({
      useSidepanelStore: () => sidepanelStore
    }))

    vi.doMock('@/stores/ui/session', () => ({
      useSessionStore: () => ({
        sessions: [],
        activeSessionId: null,
        activeSession: undefined
      })
    }))

    vi.doMock('@api/legacy/presenters', () => ({
      useLegacyPresenter: () => ({})
    }))

    const LinkNode = (await import('@/components/markdown/LinkNode.vue')).default
    const wrapper = mount(LinkNode, {
      props: {
        node: {
          href: './docs/README.md',
          text: 'README.md'
        },
        linkContext: {
          source: 'workspace',
          sessionId: 'session-1',
          sourceFilePath: '/repo/guide.md'
        }
      }
    })

    expect(wrapper.get('a').text()).toBe('README.md')
  })

  it('opens http links in the system browser on Alt click', async () => {
    const { wrapper, sidepanelStore } = await setup({
      href: 'https://example.com'
    })

    await wrapper.get('a').trigger('click', { altKey: true })

    expect(window.api.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(sidepanelStore.openBrowser).not.toHaveBeenCalled()
    expect(window.deepchat.invoke).not.toHaveBeenCalledWith('browser.loadUrl', expect.anything())
  })

  it('opens mailto links externally without using YoBrowser', async () => {
    const { wrapper, sidepanelStore } = await setup({
      href: 'mailto:test@example.com'
    })

    await wrapper.get('a').trigger('click')

    expect(window.api.openExternal).toHaveBeenCalledWith('mailto:test@example.com')
    expect(sidepanelStore.openBrowser).not.toHaveBeenCalled()
    expect(window.deepchat.invoke).not.toHaveBeenCalledWith('browser.loadUrl', expect.anything())
  })

  it('opens local markdown links in the workspace preview', async () => {
    const deepchatInvoke = window.deepchat.invoke as ReturnType<typeof vi.fn>
    deepchatInvoke.mockImplementation((routeName: string) => {
      if (routeName === 'workspace.resolveMarkdownLinkedFile') {
        return Promise.resolve({
          resolution: {
            path: '/repo/docs/README.md',
            name: 'README.md',
            relativePath: 'docs/README.md',
            workspaceRoot: '/repo'
          }
        })
      }

      return Promise.resolve({})
    })

    const { wrapper, sidepanelStore } = await setup({
      href: './docs/README.md',
      linkContext: {
        source: 'workspace',
        sessionId: 'session-1',
        sourceFilePath: '/repo/guide.md'
      }
    })

    await wrapper.get('a').trigger('click')

    expect(window.deepchat.invoke).toHaveBeenCalledWith('workspace.resolveMarkdownLinkedFile', {
      workspacePath: '/repo',
      href: './docs/README.md',
      sourceFilePath: '/repo/guide.md'
    })
    expect(sidepanelStore.selectFile).toHaveBeenCalledWith('session-1', '/repo/docs/README.md', {
      open: true,
      viewMode: 'preview'
    })
  })

  it('keeps same-document fragments inside the current document', async () => {
    const scrollIntoView = vi.fn()
    const target = document.createElement('div')
    target.id = 'details'
    Object.defineProperty(target, 'scrollIntoView', {
      value: scrollIntoView,
      writable: true
    })
    document.body.appendChild(target)

    const { wrapper, sidepanelStore } = await setup({
      href: '#details'
    })

    await wrapper.get('a').trigger('click')

    expect(scrollIntoView).toHaveBeenCalled()
    expect(sidepanelStore.openBrowser).not.toHaveBeenCalled()
    expect(window.deepchat.invoke).not.toHaveBeenCalledWith('browser.loadUrl', expect.anything())
    expect(window.deepchat.invoke).not.toHaveBeenCalledWith(
      'workspace.resolveMarkdownLinkedFile',
      expect.anything()
    )
    expect(window.api.openExternal).not.toHaveBeenCalled()
  })
})
