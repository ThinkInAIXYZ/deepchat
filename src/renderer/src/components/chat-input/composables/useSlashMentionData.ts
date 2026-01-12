// === Vue Core ===
import { watch, type Ref } from 'vue'

// === Types ===
import type { CategorizedData } from '../../editor/mention/suggestion'

// === Stores ===
import { useSkillsStore } from '@/stores/skillsStore'
import { useAgentMcpData } from './useAgentMcpData'

// === Slash Mention System ===
import { slashMentionData } from '../../editor/mention/slashSuggestion'

/**
 * Composable for managing slash mention data aggregation
 *
 * Watches skills, prompts, and tools data sources and updates
 * slashMentionData ref for the `/` trigger suggestion list.
 *
 * Data is sorted: skills first, then prompts, then tools
 */
export function useSlashMentionData(conversationId: Ref<string | null>) {
  const skillsStore = useSkillsStore()
  const { tools, prompts } = useAgentMcpData()

  /**
   * Build the slash mention data from all sources
   */
  const buildSlashMentionData = (): CategorizedData[] => {
    const items: CategorizedData[] = []

    // Add skills
    for (const skill of skillsStore.skills) {
      items.push({
        id: skill.name,
        label: skill.name,
        icon: undefined, // Using emoji icon in MentionList.vue
        type: 'item' as const,
        category: 'skills',
        description: skill.description || ''
      })
    }

    // Add prompts
    for (const prompt of prompts.value) {
      items.push({
        id: prompt.name,
        label: prompt.name,
        icon: undefined, // Using emoji icon in MentionList.vue
        type: 'item' as const,
        category: 'prompts',
        description: prompt.description || '',
        mcpEntry: prompt
      })
    }

    // Add tools
    for (const tool of tools.value) {
      items.push({
        id: `${tool.server.name}.${tool.function.name ?? ''}`,
        label: `${tool.server.icons}${' '}${tool.function.name ?? ''}`,
        icon: undefined, // Using emoji icon in MentionList.vue
        type: 'item' as const,
        category: 'tools',
        description: tool.function.description ?? ''
      })
    }

    return items
  }

  /**
   * Update slash mention data
   */
  const updateSlashMentionData = () => {
    slashMentionData.value = buildSlashMentionData()
  }

  // === Watchers ===

  // Watch skills changes
  watch(
    () => skillsStore.skills,
    () => {
      updateSlashMentionData()
    },
    { immediate: true, deep: true }
  )

  // Watch prompts changes
  watch(
    () => prompts.value,
    () => {
      updateSlashMentionData()
    },
    { immediate: true }
  )

  // Watch tools changes
  watch(
    () => tools.value,
    () => {
      updateSlashMentionData()
    },
    { immediate: true }
  )

  // Watch conversation changes to reload skills
  watch(
    () => conversationId.value,
    () => {
      // Ensure skills are loaded
      if (skillsStore.skills.length === 0) {
        skillsStore.loadSkills()
      }
    },
    { immediate: true }
  )

  // === Return Public API ===
  return {
    slashMentionData,
    updateSlashMentionData
  }
}
