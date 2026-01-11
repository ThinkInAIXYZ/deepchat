// === Vue Core ===
import { watch, type Ref } from 'vue'

// === Types ===
import type { MessageFile } from '@shared/chat'
import type { CategorizedData } from '../../editor/mention/suggestion'

// === Stores ===
import { useAgentMcpData } from './useAgentMcpData'

// === Mention System ===
import { mentionData } from '../../editor/mention/suggestion'

/**
 * Composable for managing @ mention data aggregation
 *
 * Watches various data sources (files, MCP resources) and updates mention data.
 *
 * NOTE: Tools and prompts have been moved to the `/` trigger (slashSuggestion).
 * The `@` trigger now only shows: files, resources, and workspace files.
 */
export function useMentionData(selectedFiles: Ref<MessageFile[]>) {
  const { resources } = useAgentMcpData()

  // === Watchers ===
  /**
   * Watch selected files and update mention data
   */
  watch(
    () => selectedFiles.value,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'files')
        .concat(
          selectedFiles.value.map((file) => ({
            id: file.metadata.fileName,
            label: file.metadata.fileName,
            icon: file.mimeType?.startsWith('image/') ? 'lucide:image' : 'lucide:file',
            type: 'item' as const,
            category: 'files' as const
          }))
        )
    },
    { deep: true, immediate: true }
  )

  /**
   * Watch MCP resources and update mention data
   */
  watch(
    () => resources.value,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'resources')
        .concat(
          resources.value.map((resource) => ({
            id: `${resource.client.name}.${resource.name ?? ''}`,
            label: resource.name ?? '',
            icon: 'lucide:tag',
            type: 'item' as const,
            category: 'resources' as const,
            mcpEntry: resource
          }))
        )
    },
    { immediate: true }
  )

  // NOTE: Tools and prompts watchers removed - they are now handled by useSlashMentionData

  // === Public Methods ===
  /**
   * Find mention by name
   */
  const findMentionByName = (name: string): CategorizedData | null => {
    const foundMention = mentionData.value.find(
      (item) => item.type === 'item' && (item.label === name || item.id === name)
    )
    return foundMention || null
  }

  // === Return Public API ===
  return {
    // Methods
    findMentionByName,

    // Exposed reactive reference (for backward compatibility with suggestion.ts)
    mentionData
  }
}
