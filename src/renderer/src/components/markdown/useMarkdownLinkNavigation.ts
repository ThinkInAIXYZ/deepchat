import { toValue, type MaybeRefOrGetter } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useSessionStore } from '@/stores/ui/session'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { classifyMarkdownLink, type MarkdownLinkContext } from './linkTypes'

interface UseMarkdownLinkNavigationOptions {
  linkContext?: MaybeRefOrGetter<MarkdownLinkContext | undefined>
}

type SessionContext = {
  sessionId: string | null
  workspacePath: string | null
  sourceFilePath: string | null
}

function buildSafeAttributeSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function useMarkdownLinkNavigation(options: UseMarkdownLinkNavigationOptions = {}) {
  const sessionStore = useSessionStore()
  const sidepanelStore = useSidepanelStore()
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
  const workspacePresenter = usePresenter('workspacePresenter')

  const getSessionContext = (): SessionContext => {
    const linkContext = toValue(options.linkContext)
    const sessionId = linkContext?.sessionId ?? sessionStore.activeSessionId
    const session =
      sessionStore.sessions.find((item) => item.id === sessionId) ??
      (sessionId === sessionStore.activeSessionId ? sessionStore.activeSession : undefined)
    const workspacePath = session?.projectDir?.trim() || null

    return {
      sessionId,
      workspacePath,
      sourceFilePath: linkContext?.sourceFilePath?.trim() || null
    }
  }

  const openExternal = async (url: string): Promise<boolean> => {
    if (!window.api?.openExternal) {
      return false
    }

    try {
      await window.api.openExternal(url)
      return true
    } catch (error) {
      console.warn('[markdown-links] Failed to open external link:', url, error)
      return false
    }
  }

  const scrollToFragment = (fragment: string): boolean => {
    const decodedFragment = decodeURIComponent(fragment)
    if (!decodedFragment) {
      return true
    }

    const byId = document.getElementById(decodedFragment)
    if (byId) {
      byId.scrollIntoView({ block: 'start' })
      return true
    }

    const byName = document.querySelector(
      `[name="${buildSafeAttributeSelector(decodedFragment)}"]`
    ) as HTMLElement | null
    if (byName) {
      byName.scrollIntoView({ block: 'start' })
      return true
    }

    return false
  }

  const openInYoBrowser = async (url: string): Promise<boolean> => {
    const { sessionId } = getSessionContext()
    if (!sessionId) {
      return openExternal(url)
    }

    try {
      sidepanelStore.openBrowser()
      await yoBrowserPresenter.loadUrl(sessionId, url)
      return true
    } catch (error) {
      console.warn('[markdown-links] Failed to open link in YoBrowser:', url, error)
      return openExternal(url)
    }
  }

  const openLocalFile = async (href: string): Promise<boolean> => {
    const { sessionId, workspacePath, sourceFilePath } = getSessionContext()
    const resolution = await workspacePresenter.resolveMarkdownLinkedFile({
      workspacePath,
      href,
      sourceFilePath
    })

    if (!resolution) {
      console.warn('[markdown-links] Failed to resolve local markdown link:', href)
      return false
    }

    if (sessionId) {
      sidepanelStore.selectFile(sessionId, resolution.path, {
        open: true,
        viewMode: 'preview'
      })
      return true
    }

    await workspacePresenter.openFile(resolution.path)
    return true
  }

  const navigateLink = async (href: string, event?: MouseEvent | null): Promise<boolean> => {
    const target = classifyMarkdownLink(href)

    switch (target.kind) {
      case 'fragment':
        event?.preventDefault()
        scrollToFragment(target.fragment)
        return true
      case 'web':
        event?.preventDefault()
        if (event?.altKey) {
          return openExternal(target.url)
        }
        return openInYoBrowser(target.url)
      case 'system':
      case 'external':
        event?.preventDefault()
        return openExternal(target.url)
      case 'local-file':
        event?.preventDefault()
        return openLocalFile(target.href)
      default:
        return false
    }
  }

  return {
    navigateLink
  }
}
