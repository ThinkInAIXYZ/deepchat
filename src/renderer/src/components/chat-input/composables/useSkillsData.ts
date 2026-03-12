// === Vue Core ===
import { ref, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

// === Types ===
import type { SkillMetadata } from '@shared/types/skill'
import type { IpcRendererEvent } from 'electron'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

// === Stores ===
import { useSkillsStore } from '@/stores/skillsStore'

// === Events ===
import { SKILL_EVENTS } from '@/events'

/**
 * Composable for managing skills data in chat input context
 *
 * This composable provides:
 * - Access to all available skills from the skills store
 * - Per-session active skills management
 * - Pending skills for new threads (applied when session is created)
 * - Toggle functionality for activating/deactivating skills
 * - Event listeners for real-time updates
 */
export function useSkillsData(sessionId: Ref<string | null> | ComputedRef<string | null>) {
  const skillPresenter = usePresenter('skillPresenter')
  const skillsStore = useSkillsStore()

  // === State ===
  const activeSkills = ref<string[]>([])
  const pendingSkills = ref<string[]>([]) // Skills selected before conversation exists
  const loading = ref(false)

  // === Computed ===
  /**
   * All available skills from the store
   */
  const skills = computed<SkillMetadata[]>(() => skillsStore.skills)

  /**
   * Effective active skills - uses pending skills if no conversation, otherwise real active skills
   */
  const effectiveActiveSkills = computed(() => {
    return sessionId.value ? activeSkills.value : pendingSkills.value
  })

  /**
   * Count of currently active skills
   */
  const activeCount = computed(() => effectiveActiveSkills.value.length)

  /**
   * Skills that are currently active (full metadata)
   */
  const activeSkillItems = computed(() => {
    const activeSet = new Set(effectiveActiveSkills.value)
    return skills.value.filter((skill) => activeSet.has(skill.name))
  })

  /**
   * Skills that are available but not active
   */
  const availableSkills = computed(() => {
    const activeSet = new Set(effectiveActiveSkills.value)
    return skills.value.filter((skill) => !activeSet.has(skill.name))
  })

  // === Methods ===
  /**
   * Load active skills for the current session
   */
  const loadActiveSkills = async () => {
    if (!sessionId.value) {
      activeSkills.value = []
      return
    }

    loading.value = true
    try {
      activeSkills.value = await skillPresenter.getActiveSkills(sessionId.value)
    } catch (error) {
      console.error('[useSkillsData] Failed to load active skills:', error)
      activeSkills.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Toggle a skill's activation state
   * Works for both existing sessions and pending state
   */
  const toggleSkill = async (skillName: string) => {
    // If no session, toggle in pending skills
    if (!sessionId.value) {
      const isCurrentlyPending = pendingSkills.value.includes(skillName)
      pendingSkills.value = isCurrentlyPending
        ? pendingSkills.value.filter((s) => s !== skillName)
        : [...pendingSkills.value, skillName]
      return
    }

    const isCurrentlyActive = activeSkills.value.includes(skillName)
    const updatedSkills = isCurrentlyActive
      ? activeSkills.value.filter((s) => s !== skillName)
      : [...activeSkills.value, skillName]

    try {
      await skillPresenter.setActiveSkills(sessionId.value, updatedSkills)
      activeSkills.value = updatedSkills
    } catch (error) {
      console.error('[useSkillsData] Failed to toggle skill:', error)
    }
  }

  /**
   * Activate a specific skill
   */
  const activateSkill = async (skillName: string) => {
    // If no session, add to pending skills
    if (!sessionId.value) {
      if (!pendingSkills.value.includes(skillName)) {
        pendingSkills.value = [...pendingSkills.value, skillName]
      }
      return
    }

    if (activeSkills.value.includes(skillName)) return

    const updatedSkills = [...activeSkills.value, skillName]
    try {
      await skillPresenter.setActiveSkills(sessionId.value, updatedSkills)
      activeSkills.value = updatedSkills
    } catch (error) {
      console.error('[useSkillsData] Failed to activate skill:', error)
    }
  }

  /**
   * Deactivate a specific skill
   */
  const deactivateSkill = async (skillName: string) => {
    // If no session, remove from pending skills
    if (!sessionId.value) {
      pendingSkills.value = pendingSkills.value.filter((s) => s !== skillName)
      return
    }

    if (!activeSkills.value.includes(skillName)) return

    const updatedSkills = activeSkills.value.filter((s) => s !== skillName)
    try {
      await skillPresenter.setActiveSkills(sessionId.value, updatedSkills)
      activeSkills.value = updatedSkills
    } catch (error) {
      console.error('[useSkillsData] Failed to deactivate skill:', error)
    }
  }

  /**
   * Get pending skills and clear them (called when conversation is created)
   */
  const consumePendingSkills = () => {
    const pending = [...pendingSkills.value]
    pendingSkills.value = []
    return pending
  }

  /**
   * Apply pending skills to a newly created session
   */
  const applyPendingSkillsToSession = async (newSessionId: string) => {
    const pending = consumePendingSkills()
    if (pending.length > 0) {
      try {
        await skillPresenter.setActiveSkills(newSessionId, pending)
      } catch (error) {
        console.error('[useSkillsData] Failed to apply pending skills:', error)
      }
    }
  }

  // === IPC Event Handlers ===
  const handleSkillActivated = (
    _event: IpcRendererEvent,
    payload: { conversationId: string; skills: string[] }
  ) => {
    if (payload.conversationId === sessionId.value && Array.isArray(payload.skills)) {
      // Add newly activated skills
      const currentSet = new Set(activeSkills.value)
      payload.skills.forEach((skill: string) => currentSet.add(skill))
      activeSkills.value = Array.from(currentSet)
    }
  }

  const handleSkillDeactivated = (
    _event: IpcRendererEvent,
    payload: { conversationId: string; skills: string[] }
  ) => {
    if (payload.conversationId === sessionId.value && Array.isArray(payload.skills)) {
      // Remove deactivated skills
      const deactivatedSet = new Set(payload.skills)
      activeSkills.value = activeSkills.value.filter((s) => !deactivatedSet.has(s))
    }
  }

  // === Watchers ===
  // Watch for session changes and reload active skills
  watch(
    () => sessionId.value,
    () => {
      loadActiveSkills()
    },
    { immediate: true }
  )

  // === Lifecycle ===
  onMounted(() => {
    // Load skills list if not already loaded
    if (skillsStore.skills.length === 0) {
      skillsStore.loadSkills()
    }

    // Listen for skill activation events from main process via IPC
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on(SKILL_EVENTS.ACTIVATED, handleSkillActivated)
      window.electron.ipcRenderer.on(SKILL_EVENTS.DEACTIVATED, handleSkillDeactivated)
    }
  })

  onUnmounted(() => {
    // Remove IPC event listeners
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.removeListener(SKILL_EVENTS.ACTIVATED, handleSkillActivated)
      window.electron.ipcRenderer.removeListener(SKILL_EVENTS.DEACTIVATED, handleSkillDeactivated)
    }
  })

  // === Return Public API ===
  return {
    // State
    skills,
    activeSkills: effectiveActiveSkills, // Return effective skills (pending or real)
    activeCount,
    activeSkillItems,
    availableSkills,
    loading,
    pendingSkills,

    // Methods
    loadActiveSkills,
    toggleSkill,
    activateSkill,
    deactivateSkill,
    consumePendingSkills,
    applyPendingSkillsToSession
  }
}
