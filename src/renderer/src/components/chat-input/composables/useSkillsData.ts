// === Vue Core ===
import { ref, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue'

// === Types ===
import type { SkillMetadata } from '@shared/types/skill'

// === Composables ===
import { createSkillClient } from '@api/SkillClient'

// === Stores ===
import { useSkillsStore } from '@/stores/skillsStore'

/**
 * Composable for managing skills data in chat input context
 *
 * This composable provides:
 * - Access to all available skills from the skills store
 * - Local composer skill selection for the next message
 * - Session active skills for externally/manual pinned skills
 * - Toggle functionality for selecting/deselecting message skills
 * - Event listeners for real-time updates
 */
export function useSkillsData(conversationId: Ref<string | null> | ComputedRef<string | null>) {
  const skillClient = createSkillClient()
  const skillsStore = useSkillsStore()
  let unsubscribeSkillSessionChanged: (() => void) | null = null

  // === State ===
  const activeSkills = ref<string[]>([])
  const pendingSkills = ref<string[]>([]) // Skills selected for the next message in the composer
  const loading = ref(false)

  // === Computed ===
  /**
   * All available skills from the store
   */
  const skills = computed<SkillMetadata[]>(() => skillsStore.skills)

  /**
   * Effective composer skills. Session-pinned active skills are loaded separately and are not
   * shown as message chips in the composer.
   */
  const composerActiveSkills = computed(() => pendingSkills.value)

  /**
   * Count of currently active skills
   */
  const composerActiveCount = computed(() => composerActiveSkills.value.length)

  /**
   * Skills that are currently active (full metadata)
   */
  const composerActiveSkillItems = computed(() => {
    const activeSet = new Set(composerActiveSkills.value)
    return skills.value.filter((skill) => activeSet.has(skill.name))
  })

  /**
   * Skills that are available but not active
   */
  const availableSkills = computed(() => {
    const activeSet = new Set(composerActiveSkills.value)
    return skills.value.filter((skill) => !activeSet.has(skill.name))
  })

  // === Methods ===
  /**
   * Load active skills for the current conversation
   */
  const loadActiveSkills = async () => {
    if (!conversationId.value) {
      activeSkills.value = []
      return
    }

    loading.value = true
    try {
      activeSkills.value = await skillClient.getActiveSkills(conversationId.value)
    } catch (error) {
      console.error('[useSkillsData] Failed to load active skills:', error)
      activeSkills.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Toggle a skill for the next message only.
   */
  const toggleSkill = async (skillName: string) => {
    const isCurrentlyPending = pendingSkills.value.includes(skillName)
    pendingSkills.value = isCurrentlyPending
      ? pendingSkills.value.filter((s) => s !== skillName)
      : [...pendingSkills.value, skillName]
  }

  /**
   * Select a specific skill for the next message only.
   */
  const activateSkill = async (skillName: string) => {
    if (!pendingSkills.value.includes(skillName)) {
      pendingSkills.value = [...pendingSkills.value, skillName]
    }
  }

  /**
   * Deselect a skill from the next message.
   */
  const deactivateSkill = async (skillName: string) => {
    pendingSkills.value = pendingSkills.value.filter((s) => s !== skillName)
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
   * Clear composer skills after they have been attached to a submitted message.
   */
  const clearPendingSkills = () => {
    pendingSkills.value = []
  }

  // === IPC Event Handlers ===
  const handleSkillSessionChanged = (payload: {
    conversationId: string
    skills: string[]
    change: 'activated' | 'deactivated'
  }) => {
    if (payload.conversationId === conversationId.value && Array.isArray(payload.skills)) {
      if (payload.change === 'activated') {
        const currentSet = new Set(activeSkills.value)
        payload.skills.forEach((skill: string) => currentSet.add(skill))
        activeSkills.value = Array.from(currentSet)
        return
      }

      const deactivatedSet = new Set(payload.skills)
      activeSkills.value = activeSkills.value.filter((s) => !deactivatedSet.has(s))
    }
  }

  // === Watchers ===
  // Watch for conversation changes and reload active skills
  watch(
    () => conversationId.value,
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

    unsubscribeSkillSessionChanged = skillClient.onSessionChanged(handleSkillSessionChanged)
  })

  onUnmounted(() => {
    unsubscribeSkillSessionChanged?.()
    unsubscribeSkillSessionChanged = null
  })

  // === Return Public API ===
  return {
    // State
    skills,
    composerActiveSkills,
    composerActiveCount,
    composerActiveSkillItems,
    availableSkills,
    loading,
    pendingSkills,

    // Methods
    loadActiveSkills,
    toggleSkill,
    activateSkill,
    deactivateSkill,
    consumePendingSkills,
    clearPendingSkills
  }
}
