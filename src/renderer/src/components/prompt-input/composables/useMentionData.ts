// === Vue Core ===
import { watch, type Ref } from 'vue'

// === Types ===
import type { MessageFile } from '@shared/chat'
import type { CategorizedData } from '../../editor/mention/suggestion'

// === Stores ===
import { useMcpStore } from '@/stores/mcp'

// === Mention System ===
import { mentionData } from '../../editor/mention/suggestion'

/**
 * Composable for managing mention data aggregation
 * Watches various data sources (files, MCP resources/tools/prompts) and updates mention data
 */
export function useMentionData(selectedFiles: Ref<MessageFile[]>) {
  // === Stores ===
  const mcpStore = useMcpStore()

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
    { deep: true }
  )

  /**
   * Watch MCP resources and update mention data
   */
  watch(
    () => mcpStore.resources,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'resources')
        .concat(
          mcpStore.resources.map((resource) => ({
            id: `${resource.client.name}.${resource.name ?? ''}`,
            label: resource.name ?? '',
            icon: 'lucide:tag',
            type: 'item' as const,
            category: 'resources' as const,
            mcpEntry: resource
          }))
        )
    }
  )

  /**
   * Watch MCP tools and update mention data
   */
  watch(
    () => mcpStore.tools,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'tools')
        .concat(
          mcpStore.tools.map((tool) => ({
            id: `${tool.server.name}.${tool.function.name ?? ''}`,
            label: `${tool.server.icons}${' '}${tool.function.name ?? ''}`,
            icon: undefined,
            type: 'item' as const,
            category: 'tools' as const,
            description: tool.function.description ?? ''
          }))
        )
    }
  )

  /**
   * Watch MCP prompts and update mention data
   */
  watch(
    () => mcpStore.prompts,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'prompts')
        .concat(
          mcpStore.prompts.map((prompt) => ({
            id: prompt.name,
            label: prompt.name,
            icon: undefined,
            type: 'item' as const,
            category: 'prompts' as const,
            mcpEntry: prompt
          }))
        )
    }
  )

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
