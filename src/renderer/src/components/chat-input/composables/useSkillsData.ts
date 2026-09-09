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
 * - Existing persistent Session active skills
 * - Toggle functionality for selecting/deselecting message skills
 * - Event listeners for real-time updates
 */
export function useSkillsData(
  conversationId: Ref<string | null> | ComputedRef<string | null>,
  agentId: Ref<string | null> | ComputedRef<string | null>,
  workspacePath?: Ref<string | null> | ComputedRef<string | null>
) {
  const skillClient = createSkillClient()
  const skillsStore = useSkillsStore()
  let unsubscribeSkillSessionChanged: (() => void) | null = null
  let unsubscribeCatalogChanged: (() => void) | null = null
  let projectLoadSequence = 0
  const projectSkills = ref<SkillMetadata[]>([])
  const projectLoading = ref(false)
  const normalizedWorkspacePath = computed(() => workspacePath?.value?.trim() || null)
  let activeSkillsLoadSequence = 0
  let activeSkillMutationSequence = 0

  // === State ===
  const sessionActiveSkills = ref<string[]>([])
  const pendingSkills = ref<string[]>([]) // Skills selected for the next message in the composer
  const sessionActiveSkillsLoading = ref(false)
  const sessionActiveSkillRemoving = ref<string | null>(null)
  const normalizedAgentId = computed(() => agentId.value?.trim() || 'deepchat')

  // === Computed ===
  /**
   * All available skills from the store
   */
  const skills = computed<SkillMetadata[]>(() =>
    normalizedWorkspacePath.value
      ? projectSkills.value
      : skillsStore.getSkillsForAgent(normalizedAgentId.value)
  )
  const loading = computed(
    () =>
      sessionActiveSkillsLoading.value ||
      projectLoading.value ||
      skillsStore.isSkillsLoading(normalizedAgentId.value)
  )

  /**
   * Effective composer skills. Persistent Session active skills are loaded separately and are not
   * mixed with next-message chips in the editor.
   */
  const composerActiveSkills = computed(() => pendingSkills.value)

  /**
   * Count of Skills selected for the next message.
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
   * Load persistent active skills for the current Session.
   */
  const loadActiveSkills = async () => {
    const requestedConversationId = conversationId.value
    const sequence = ++activeSkillsLoadSequence
    if (!requestedConversationId) {
      sessionActiveSkills.value = []
      sessionActiveSkillsLoading.value = false
      return
    }

    sessionActiveSkillsLoading.value = true
    try {
      const loadedSkills = await skillClient.getActiveSkills(requestedConversationId)
      if (
        sequence === activeSkillsLoadSequence &&
        conversationId.value === requestedConversationId
      ) {
        sessionActiveSkills.value = loadedSkills
      }
    } catch (error) {
      console.error('[useSkillsData] Failed to load active skills:', error)
      if (
        sequence === activeSkillsLoadSequence &&
        conversationId.value === requestedConversationId
      ) {
        sessionActiveSkills.value = []
      }
    } finally {
      if (sequence === activeSkillsLoadSequence) {
        sessionActiveSkillsLoading.value = false
      }
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

  /** Remove one existing persistent Skill without exposing a path that creates Session state. */
  const removeSessionActiveSkill = async (skillName: string) => {
    const requestedConversationId = conversationId.value
    if (
      !requestedConversationId ||
      sessionActiveSkillsLoading.value ||
      sessionActiveSkillRemoving.value
    ) {
      return
    }

    if (!sessionActiveSkills.value.includes(skillName)) {
      return
    }

    const mutationSequence = ++activeSkillMutationSequence
    sessionActiveSkillRemoving.value = skillName
    try {
      const updatedSkills = await skillClient.removeActiveSkill(requestedConversationId, skillName)
      if (
        mutationSequence === activeSkillMutationSequence &&
        conversationId.value === requestedConversationId
      ) {
        sessionActiveSkills.value = updatedSkills
      }
    } catch (error) {
      if (
        mutationSequence === activeSkillMutationSequence &&
        conversationId.value === requestedConversationId
      ) {
        throw error
      }
    } finally {
      if (mutationSequence === activeSkillMutationSequence) {
        sessionActiveSkillRemoving.value = null
      }
    }
  }

  // === IPC Event Handlers ===
  const handleSkillSessionChanged = (payload: {
    conversationId: string
    skills: string[]
    change: 'activated' | 'deactivated'
  }) => {
    if (payload.conversationId === conversationId.value && Array.isArray(payload.skills)) {
      if (sessionActiveSkillsLoading.value) {
        void loadActiveSkills()
        return
      }

      if (payload.change === 'activated') {
        const currentSet = new Set(sessionActiveSkills.value)
        payload.skills.forEach((skill: string) => currentSet.add(skill))
        sessionActiveSkills.value = Array.from(currentSet)
        return
      }

      const deactivatedSet = new Set(payload.skills)
      sessionActiveSkills.value = sessionActiveSkills.value.filter(
        (skill) => !deactivatedSet.has(skill)
      )
    }
  }

  const refreshProjectSkills = async () => {
    const sequence = ++projectLoadSequence
    const requestedWorkspace = normalizedWorkspacePath.value
    const requestedAgent = normalizedAgentId.value
    if (!requestedWorkspace) {
      projectSkills.value = []
      projectLoading.value = false
      return
    }
    projectLoading.value = true
    try {
      const catalog = await skillClient.getUnifiedSkillCatalog(requestedAgent, requestedWorkspace)
      if (sequence === projectLoadSequence) projectSkills.value = catalog
    } catch (error) {
      if (sequence === projectLoadSequence) projectSkills.value = []
      console.error('[useSkillsData] Failed to load project skills:', error)
    } finally {
      if (sequence === projectLoadSequence) projectLoading.value = false
    }
  }

  // === Watchers ===
  // Watch for conversation changes and reload active skills
  watch(
    () => conversationId.value,
    () => {
      activeSkillMutationSequence += 1
      sessionActiveSkills.value = []
      sessionActiveSkillRemoving.value = null
      void loadActiveSkills()
    },
    { immediate: true }
  )

  watch(
    [normalizedAgentId, normalizedWorkspacePath],
    ([nextAgentId, nextWorkspace], [previousAgentId, previousWorkspace]) => {
      projectSkills.value = []
      if (
        previousAgentId &&
        (previousAgentId !== nextAgentId || previousWorkspace !== nextWorkspace)
      ) {
        pendingSkills.value = []
        activeSkillMutationSequence += 1
        sessionActiveSkills.value = []
        sessionActiveSkillRemoving.value = null
        void loadActiveSkills()
      }
      if (!nextWorkspace) void skillsStore.ensureSkillsLoaded(nextAgentId)
      void refreshProjectSkills()
    },
    { immediate: true }
  )

  // === Lifecycle ===
  onMounted(() => {
    unsubscribeSkillSessionChanged = skillClient.onSessionChanged(handleSkillSessionChanged)
    unsubscribeCatalogChanged = skillClient.onCatalogChanged(() => {
      if (normalizedWorkspacePath.value) void refreshProjectSkills()
    })
    window.addEventListener('focus', refreshProjectSkills)
  })

  onUnmounted(() => {
    projectLoadSequence += 1
    unsubscribeCatalogChanged?.()
    window.removeEventListener('focus', refreshProjectSkills)
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
    sessionActiveSkills,
    sessionActiveSkillsLoading,
    sessionActiveSkillRemoving,

    // Methods
    loadActiveSkills,
    toggleSkill,
    activateSkill,
    deactivateSkill,
    consumePendingSkills,
    clearPendingSkills,
    removeSessionActiveSkill
  }
}
