import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import type { AgentPlanTerminalReason } from '@shared/types/agent-plan'

export type AgentPlanViewSnapshot = DeepchatEventPayload<'chat.plan.updated'>

export type AgentPlanViewState = {
  collapsed: boolean
  dismissedMessageId?: string
}

type AgentPlanViewStatePatch = Omit<Partial<AgentPlanViewState>, 'dismissedMessageId'> & {
  dismissedMessageId?: string | null
}

const VIEW_STATE_STORAGE_KEY = 'agent-plan-view-state'
const LEGACY_COLLAPSED_STORAGE_KEY = 'agent-plan-collapsed'

const defaultViewState = (): AgentPlanViewState => ({
  collapsed: false
})

const hasOpenStep = (snapshot: AgentPlanViewSnapshot): boolean =>
  snapshot.plan.some((entry) => entry.status === 'in_progress')

const isAllCompleted = (snapshot: AgentPlanViewSnapshot): boolean =>
  snapshot.plan.length > 0 && snapshot.plan.every((entry) => entry.status === 'completed')

export const useAgentPlanStore = defineStore('agentPlan', () => {
  const snapshots = ref<Record<string, AgentPlanViewSnapshot>>({})
  const viewStateBySession = useStorage<Record<string, AgentPlanViewState>>(
    VIEW_STATE_STORAGE_KEY,
    {}
  )

  globalThis.localStorage?.removeItem(LEGACY_COLLAPSED_STORAGE_KEY)

  const readViewState = (sessionId: string): AgentPlanViewState => {
    const current = viewStateBySession.value[sessionId]
    if (!current) {
      return defaultViewState()
    }

    return {
      collapsed: typeof current.collapsed === 'boolean' ? current.collapsed : false,
      ...(typeof current.dismissedMessageId === 'string' && current.dismissedMessageId
        ? { dismissedMessageId: current.dismissedMessageId }
        : {})
    }
  }

  const setViewState = (sessionId: string, patch: AgentPlanViewStatePatch): void => {
    const current = readViewState(sessionId)
    const nextDismissedMessageId = Object.prototype.hasOwnProperty.call(patch, 'dismissedMessageId')
      ? patch.dismissedMessageId || undefined
      : current.dismissedMessageId
    const nextState: AgentPlanViewState = {
      collapsed: typeof patch.collapsed === 'boolean' ? patch.collapsed : current.collapsed,
      ...(nextDismissedMessageId ? { dismissedMessageId: nextDismissedMessageId } : {})
    }
    viewStateBySession.value = {
      ...viewStateBySession.value,
      [sessionId]: nextState
    }
  }

  const applySnapshot = (snapshot: AgentPlanViewSnapshot): void => {
    const current = snapshots.value[snapshot.sessionId]
    const isNewMessage = Boolean(current && current.messageId !== snapshot.messageId)
    const shouldAutoCollapse =
      current !== undefined && !isNewMessage && !isAllCompleted(current) && isAllCompleted(snapshot)
    const terminalChanged =
      !isNewMessage &&
      Boolean(snapshot.terminalReason) &&
      snapshot.terminalReason !== current?.terminalReason
    if (
      current &&
      !isNewMessage &&
      (current.revision > snapshot.revision ||
        (current.revision === snapshot.revision && !terminalChanged))
    ) {
      return
    }

    snapshots.value = {
      ...snapshots.value,
      [snapshot.sessionId]: snapshot
    }

    if (isNewMessage) {
      setViewState(snapshot.sessionId, {
        collapsed: false,
        dismissedMessageId: null
      })
      return
    }

    if (shouldAutoCollapse && !readViewState(snapshot.sessionId).collapsed) {
      setViewState(snapshot.sessionId, { collapsed: true })
    }
  }

  const clearSnapshot = (sessionId: string): void => {
    if (!snapshots.value[sessionId]) {
      return
    }

    const next = { ...snapshots.value }
    delete next[sessionId]
    snapshots.value = next
  }

  const beginTurn = (sessionId: string): void => {
    clearSnapshot(sessionId)
    setViewState(sessionId, {
      ...defaultViewState(),
      dismissedMessageId: null
    })
  }

  const freezeActive = (
    sessionId: string,
    terminalReason: AgentPlanTerminalReason = 'aborted'
  ): void => {
    const current = snapshots.value[sessionId]
    if (!current || !hasOpenStep(current) || current.terminalReason) {
      return
    }

    snapshots.value = {
      ...snapshots.value,
      [sessionId]: {
        ...current,
        terminalReason
      }
    }
  }

  const purge = (sessionId: string): void => {
    clearSnapshot(sessionId)
    if (!viewStateBySession.value[sessionId]) {
      return
    }

    const next = { ...viewStateBySession.value }
    delete next[sessionId]
    viewStateBySession.value = next
  }

  const isCollapsed = (sessionId: string): boolean => readViewState(sessionId).collapsed

  const setCollapsed = (sessionId: string, collapsed: boolean): void => {
    setViewState(sessionId, { collapsed })
  }

  const toggleCollapsed = (sessionId: string): void => {
    setCollapsed(sessionId, !isCollapsed(sessionId))
  }

  const dismiss = (sessionId: string): void => {
    const current = snapshots.value[sessionId]
    setViewState(sessionId, {
      ...(current ? { dismissedMessageId: current.messageId } : {}),
      collapsed: true
    })
  }

  const isVisible = (sessionId: string): boolean => {
    const current = snapshots.value[sessionId]
    if (!current || current.plan.length === 0) {
      return false
    }

    return readViewState(sessionId).dismissedMessageId !== current.messageId
  }

  return {
    snapshots,
    viewStateBySession,
    applySnapshot,
    clearSnapshot,
    beginTurn,
    freezeActive,
    purge,
    isCollapsed,
    setCollapsed,
    toggleCollapsed,
    dismiss,
    isVisible
  }
})
