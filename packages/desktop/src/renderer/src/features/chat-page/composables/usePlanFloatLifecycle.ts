import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { useAgentPlanStore } from '@/stores/ui/agentPlan'
import type { useSessionStore } from '@/stores/ui/session'

type AgentPlanStore = ReturnType<typeof useAgentPlanStore>
type SessionStore = ReturnType<typeof useSessionStore>

type PendingInteractionLike = {
  sessionId: string
  messageId: string
  toolCallId: string
}

const PLAN_FLOAT_CLEAR_DELAY_MS = 1200

type UsePlanFloatLifecycleOptions = {
  sessionId: () => string
  agentPlanStore: AgentPlanStore
  sessionStore: SessionStore
  isCurrentSessionStreaming: Ref<boolean>
  pendingInteractions: ComputedRef<PendingInteractionLike[]>
}

/**
 * Owns the plan-float snapshot lifecycle across sessions: when a plan snapshot
 * should be visible, when it may linger after completion, and the delayed clear
 * that fires once a session is no longer active and has no pending interaction.
 *
 * The linger map and clear timers are keyed per session so multiple sessions can
 * hold snapshots simultaneously without racing each other's timers.
 */
export function usePlanFloatLifecycle(options: UsePlanFloatLifecycleOptions) {
  const { agentPlanStore, sessionStore, isCurrentSessionStreaming, pendingInteractions } = options
  const currentSessionId = () => options.sessionId()

  // Reactive on purpose: latestPlanSnapshot must recompute when the linger flag
  // flips in the post-flush lifecycle watch, or the float vanishes instead of
  // lingering after a session completes. Writes replace the whole object.
  const planFloatLingerBySession = ref<Record<string, boolean>>({})
  const planSnapshotClearTimers = new Map<string, number>()

  function readSessionStatus(sessionId: string): 'working' | 'completed' | 'error' | 'none' | null {
    if (sessionStore.activeSession?.id === sessionId) {
      return sessionStore.activeSession.status
    }

    return sessionStore.sessions.find((session) => session.id === sessionId)?.status ?? null
  }

  function hasPendingInteractionForSession(sessionId: string): boolean {
    return pendingInteractions.value.some((interaction) => interaction.sessionId === sessionId)
  }

  function isSessionPlanActive(sessionId: string): boolean {
    if (sessionId === currentSessionId() && isCurrentSessionStreaming.value) {
      return true
    }

    return readSessionStatus(sessionId) === 'working'
  }

  function isPlanFloatLingerActive(sessionId: string): boolean {
    return planFloatLingerBySession.value[sessionId] === true
  }

  function setPlanFloatLingerActive(sessionId: string, active: boolean): void {
    const current = planFloatLingerBySession.value[sessionId] === true
    if (current === active) {
      return
    }

    const next = { ...planFloatLingerBySession.value }
    if (active) {
      next[sessionId] = true
    } else {
      delete next[sessionId]
    }
    planFloatLingerBySession.value = next
  }

  function shouldShowPlanSnapshotForSession(sessionId: string): boolean {
    return (
      isSessionPlanActive(sessionId) ||
      hasPendingInteractionForSession(sessionId) ||
      isPlanFloatLingerActive(sessionId)
    )
  }

  const latestPlanSnapshot = computed(() => {
    const sessionId = currentSessionId()
    if (!shouldShowPlanSnapshotForSession(sessionId)) {
      return null
    }

    if (!agentPlanStore.isVisible(sessionId)) {
      return null
    }

    const snapshot = agentPlanStore.snapshots[sessionId]
    if (!snapshot || snapshot.plan.length === 0) {
      return null
    }
    return snapshot
  })

  const isPlanFloatCollapsed = computed(() => agentPlanStore.isCollapsed(currentSessionId()))

  function cancelPlanSnapshotClearTimer(sessionId: string) {
    const timer = planSnapshotClearTimers.get(sessionId)
    if (timer === undefined) {
      return
    }

    window.clearTimeout(timer)
    planSnapshotClearTimers.delete(sessionId)
  }

  function cancelAllPlanSnapshotClearTimers() {
    for (const timer of planSnapshotClearTimers.values()) {
      window.clearTimeout(timer)
    }
    planSnapshotClearTimers.clear()
  }

  function canLingerPlanSnapshot(sessionId: string): boolean {
    const snapshot = agentPlanStore.snapshots[sessionId]
    if (!snapshot || snapshot.plan.length === 0) {
      return false
    }

    return (
      Boolean(snapshot.terminalReason) ||
      snapshot.plan.every((entry) => entry.status === 'completed')
    )
  }

  function scheduleInactivePlanSnapshotClear(sessionId: string = currentSessionId()) {
    const snapshot = agentPlanStore.snapshots[sessionId]
    if (!snapshot) {
      cancelPlanSnapshotClearTimer(sessionId)
      setPlanFloatLingerActive(sessionId, false)
      return
    }

    if (isSessionPlanActive(sessionId) || hasPendingInteractionForSession(sessionId)) {
      cancelPlanSnapshotClearTimer(sessionId)
      setPlanFloatLingerActive(sessionId, false)
      return
    }

    cancelPlanSnapshotClearTimer(sessionId)

    if (!canLingerPlanSnapshot(sessionId)) {
      setPlanFloatLingerActive(sessionId, false)
      return
    }

    setPlanFloatLingerActive(sessionId, true)
    const timer = window.setTimeout(() => {
      planSnapshotClearTimers.delete(sessionId)
      if (!isSessionPlanActive(sessionId) && !hasPendingInteractionForSession(sessionId)) {
        agentPlanStore.clearSnapshot(sessionId)
        setPlanFloatLingerActive(sessionId, false)
      }
    }, PLAN_FLOAT_CLEAR_DELAY_MS)
    planSnapshotClearTimers.set(sessionId, timer)
  }

  function resetPlanSnapshotLifecycle(sessionId: string): void {
    cancelPlanSnapshotClearTimer(sessionId)
    setPlanFloatLingerActive(sessionId, false)
  }

  function beginPlanTurn(sessionId: string): void {
    resetPlanSnapshotLifecycle(sessionId)
    agentPlanStore.beginTurn(sessionId)
  }

  function clearPlanSnapshotForDeletedMessage(sessionId: string, messageId: string): void {
    const snapshot = agentPlanStore.snapshots[sessionId]
    if (snapshot?.messageId !== messageId) {
      return
    }

    resetPlanSnapshotLifecycle(sessionId)
    agentPlanStore.clearSnapshot(sessionId)
  }

  function onDismissPlanFloat() {
    agentPlanStore.dismiss(currentSessionId())
  }

  const planSnapshotLifecycleKey = computed(() =>
    Object.values(agentPlanStore.snapshots)
      .map((snapshot) => {
        const terminal = snapshot.terminalReason ?? ''
        const statuses = snapshot.plan.map((entry) => entry.status).join(',')
        return `${snapshot.sessionId}:${snapshot.messageId ?? ''}:${snapshot.revision}:${terminal}:${statuses}`
      })
      .join('|')
  )

  const sessionStatusLifecycleKey = computed(() => {
    const entries = sessionStore.sessions.map((session) => `${session.id}:${session.status}`)
    const active = sessionStore.activeSession
    if (active) {
      entries.push(`${active.id}:${active.status}`)
    }
    entries.push(
      `${currentSessionId()}:${isCurrentSessionStreaming.value ? 'streaming' : 'not-streaming'}`
    )
    return entries.sort().join('|')
  })

  const pendingInteractionLifecycleKey = computed(() =>
    pendingInteractions.value
      .map(
        (interaction) =>
          `${interaction.sessionId}:${interaction.messageId}:${interaction.toolCallId}`
      )
      .join('|')
  )

  function syncPlanSnapshotLifecycle(): void {
    for (const sessionId of Object.keys(agentPlanStore.snapshots)) {
      scheduleInactivePlanSnapshotClear(sessionId)
    }
  }

  watch(
    [planSnapshotLifecycleKey, sessionStatusLifecycleKey, pendingInteractionLifecycleKey],
    () => {
      syncPlanSnapshotLifecycle()
    },
    { flush: 'post' }
  )

  return {
    latestPlanSnapshot,
    isPlanFloatCollapsed,
    beginPlanTurn,
    clearPlanSnapshotForDeletedMessage,
    scheduleInactivePlanSnapshotClear,
    cancelAllPlanSnapshotClearTimers,
    onDismissPlanFloat
  }
}
