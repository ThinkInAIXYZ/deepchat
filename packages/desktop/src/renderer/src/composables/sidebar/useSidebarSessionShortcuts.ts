import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'
import {
  tryOnScopeDispose,
  useDocumentVisibility,
  useEventListener,
  useTimeoutFn
} from '@vueuse/core'
import { createDeviceClient } from '@api/DeviceClient'
import type { SessionGroup, UISession } from '@/stores/ui/session'

const SIDEBAR_SHORTCUT_BADGE_DELAY_MS = 500
const SIDEBAR_SHORTCUT_MAX_ROWS = 10

type ShortcutPlatform = 'mac' | 'other'

interface UseSidebarSessionShortcutsOptions {
  collapsed: MaybeRefOrGetter<boolean>
  pinnedSessions: MaybeRefOrGetter<UISession[]>
  visibleGroups: MaybeRefOrGetter<SessionGroup[]>
  isPinnedSectionCollapsed: MaybeRefOrGetter<boolean>
  isGroupCollapsed: (group: SessionGroup) => boolean
  /** Session currently animated by the pin flight; excluded from the shortcut rows. */
  excludedSessionId: MaybeRefOrGetter<string | null>
  /** App-level overlays (spotlight, dialogs owned by the caller) that own the keyboard. */
  hasOwnOverlayOpen: () => boolean
  selectSession: (sessionId: string) => void
}

/**
 * Cmd/Alt+digit shortcuts for the first visible sidebar rows: tracks the platform
 * modifier, shows numbered badges after a short hold, and activates the matching
 * session on digit press. All listeners are window-level and auto-disposed.
 */
export function useSidebarSessionShortcuts(options: UseSidebarSessionShortcutsOptions) {
  const deviceClient = createDeviceClient()

  const shortcutPlatform = ref<ShortcutPlatform>(
    navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
  )
  const shortcutModifierDown = ref(false)
  const showShortcutBadges = ref(false)

  const visibleShortcutSessions = computed<UISession[]>(() => {
    if (toValue(options.collapsed)) {
      return []
    }

    const sessions: UISession[] = []

    if (!toValue(options.isPinnedSectionCollapsed)) {
      sessions.push(...toValue(options.pinnedSessions))
    }

    for (const group of toValue(options.visibleGroups)) {
      if (!options.isGroupCollapsed(group)) {
        sessions.push(...group.sessions)
      }
    }

    return sessions
      .filter((session) => session.id !== toValue(options.excludedSessionId))
      .slice(0, SIDEBAR_SHORTCUT_MAX_ROWS)
  })

  const getShortcutDigitForIndex = (index: number) => (index === 9 ? '0' : String(index + 1))

  const getShortcutIndexForDigit = (digit: string) => (digit === '0' ? 9 : Number(digit) - 1)

  const getShortcutBadgeLabelForIndex = (index: number) => {
    const digit = getShortcutDigitForIndex(index)
    return shortcutPlatform.value === 'mac' ? `⌘${digit}` : `Alt+${digit}`
  }

  const shortcutBadgeLabelBySessionId = computed(() => {
    const labels = new Map<string, string>()

    visibleShortcutSessions.value.forEach((session, index) => {
      labels.set(session.id, getShortcutBadgeLabelForIndex(index))
    })

    return labels
  })

  const getShortcutBadgeLabelForSession = (sessionId: string) =>
    shortcutBadgeLabelBySessionId.value.get(sessionId) ?? null

  const hasShortcutBadgeForSession = (sessionId: string) =>
    showShortcutBadges.value && shortcutBadgeLabelBySessionId.value.has(sessionId)

  const loadShortcutPlatform = async () => {
    try {
      const deviceInfo = await deviceClient.getDeviceInfo()
      shortcutPlatform.value = deviceInfo.platform === 'darwin' ? 'mac' : 'other'
    } catch (error) {
      console.warn('[WindowSideBar] Failed to resolve shortcut platform:', error)
    }
  }

  const isEditableShortcutTarget = (target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null
    if (!element) {
      return false
    }

    return Boolean(
      element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    )
  }

  const hasKeyboardOwningOverlay = () =>
    options.hasOwnOverlayOpen() ||
    document.querySelector('.chat-search-bar') !== null ||
    document.querySelector('[role="dialog"][aria-modal="true"]') !== null

  const shouldIgnoreSidebarShortcutEvent = (event: KeyboardEvent) =>
    toValue(options.collapsed) ||
    isEditableShortcutTarget(event.target) ||
    hasKeyboardOwningOverlay()

  const getPlatformModifierKey = () => (shortcutPlatform.value === 'mac' ? 'Meta' : 'Alt')

  const isPlatformModifierPressed = (event: KeyboardEvent) =>
    shortcutPlatform.value === 'mac' ? event.metaKey : event.altKey

  const isPlatformModifierOnlyKeydown = (event: KeyboardEvent) => {
    if (event.repeat || shouldIgnoreSidebarShortcutEvent(event)) {
      return false
    }

    if (shortcutPlatform.value === 'mac') {
      return (
        event.key === 'Meta' && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
      )
    }

    return (
      event.key === 'Alt' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
    )
  }

  const isSidebarShortcutDigitEvent = (event: KeyboardEvent) => {
    if (event.repeat || !/^[0-9]$/.test(event.key) || shouldIgnoreSidebarShortcutEvent(event)) {
      return false
    }

    if (shortcutPlatform.value === 'mac') {
      return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
    }

    return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
  }

  const badgeRevealTimeout = useTimeoutFn(
    () => {
      if (
        shortcutModifierDown.value &&
        !toValue(options.collapsed) &&
        !hasKeyboardOwningOverlay() &&
        visibleShortcutSessions.value.length > 0
      ) {
        showShortcutBadges.value = true
      }
    },
    SIDEBAR_SHORTCUT_BADGE_DELAY_MS,
    { immediate: false }
  )

  const hideShortcutBadges = () => {
    badgeRevealTimeout.stop()
    shortcutModifierDown.value = false
    showShortcutBadges.value = false
  }

  const startShortcutBadgeTimer = () => {
    if (badgeRevealTimeout.isPending.value || showShortcutBadges.value) {
      return
    }

    shortcutModifierDown.value = true
    badgeRevealTimeout.start()
  }

  const selectShortcutSession = (digit: string) => {
    const shortcutIndex = getShortcutIndexForDigit(digit)
    const targetSession = visibleShortcutSessions.value[shortcutIndex]

    if (targetSession) {
      options.selectSession(targetSession.id)
    }
  }

  const handleWindowShortcutKeydown = (event: KeyboardEvent) => {
    if (isPlatformModifierOnlyKeydown(event)) {
      if (shortcutPlatform.value !== 'mac') {
        event.preventDefault()
      }
      startShortcutBadgeTimer()
      return
    }

    if (badgeRevealTimeout.isPending.value && event.key !== getPlatformModifierKey()) {
      badgeRevealTimeout.stop()
    }

    if (!isSidebarShortcutDigitEvent(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    selectShortcutSession(event.key)
  }

  const handleWindowShortcutKeyup = (event: KeyboardEvent) => {
    const modifierKey = getPlatformModifierKey()
    if (event.key === modifierKey || !isPlatformModifierPressed(event)) {
      if (shortcutPlatform.value !== 'mac' && event.key === modifierKey) {
        event.preventDefault()
      }
      hideShortcutBadges()
    }
  }

  useEventListener(window, 'keydown', handleWindowShortcutKeydown)
  useEventListener(window, 'keyup', handleWindowShortcutKeyup)
  useEventListener(window, 'blur', hideShortcutBadges)

  const documentVisibility = useDocumentVisibility()
  watch(documentVisibility, (visibility) => {
    if (visibility === 'hidden') {
      hideShortcutBadges()
    }
  })

  watch(
    () => toValue(options.collapsed),
    (isCollapsed) => {
      if (isCollapsed) {
        hideShortcutBadges()
      }
    }
  )

  void loadShortcutPlatform()

  tryOnScopeDispose(() => {
    hideShortcutBadges()
  })

  return {
    getShortcutBadgeLabelForSession,
    hasShortcutBadgeForSession,
    hideShortcutBadges
  }
}
