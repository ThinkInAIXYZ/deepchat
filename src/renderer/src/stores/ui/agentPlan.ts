import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import type { DeepchatEventPayload } from '@shared/contracts/events'

export type AgentPlanViewSnapshot = DeepchatEventPayload<'chat.plan.updated'>

export const useAgentPlanStore = defineStore('agentPlan', () => {
  const snapshots = ref<Record<string, AgentPlanViewSnapshot>>({})
  const collapsedBySession = useStorage<Record<string, boolean>>('agent-plan-collapsed', {})

  const applySnapshot = (snapshot: AgentPlanViewSnapshot): void => {
    const current = snapshots.value[snapshot.sessionId]
    if (current && current.revision >= snapshot.revision) {
      return
    }

    snapshots.value = {
      ...snapshots.value,
      [snapshot.sessionId]: snapshot
    }
  }

  const clear = (sessionId: string): void => {
    if (!snapshots.value[sessionId]) {
      return
    }

    const next = { ...snapshots.value }
    delete next[sessionId]
    snapshots.value = next
  }

  const isCollapsed = (sessionId: string): boolean => collapsedBySession.value[sessionId] !== false

  const setCollapsed = (sessionId: string, collapsed: boolean): void => {
    collapsedBySession.value = {
      ...collapsedBySession.value,
      [sessionId]: collapsed
    }
  }

  const toggleCollapsed = (sessionId: string): void => {
    setCollapsed(sessionId, !isCollapsed(sessionId))
  }

  return {
    snapshots,
    collapsedBySession,
    applySnapshot,
    clear,
    isCollapsed,
    setCollapsed,
    toggleCollapsed
  }
})
