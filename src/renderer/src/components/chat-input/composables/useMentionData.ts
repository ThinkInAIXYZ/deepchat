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
 * Watches various data sources (files, tools, prompts, resources) and updates mention data.
 * The `@` trigger shows: files, resources, tools, prompts, and workspace files.
 */
export function useMentionData(selectedFiles: Ref<MessageFile[]>) {
  const { resources, tools, prompts } = useAgentMcpData()

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

  /**
   * Watch MCP tools and update mention data
   */
  watch(
    () => tools.value,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'tools')
        .concat(
          tools.value.map((tool) => ({
            id: `${tool.server.name}.${tool.function.name ?? ''}`,
            label: `${tool.server.icons} ${tool.function.name ?? ''}`.trim(),
            icon: 'lucide:wrench',
            type: 'item' as const,
            category: 'tools' as const,
            description: tool.function.description ?? '',
            mcpEntry: tool
          }))
        )
    },
    { immediate: true }
  )

  /**
   * Watch MCP prompts and update mention data
   */
  watch(
    () => prompts.value,
    () => {
      mentionData.value = mentionData.value
        .filter((item) => item.type !== 'item' || item.category !== 'prompts')
        .concat(
          prompts.value.map((prompt) => ({
            id: prompt.name,
            label: prompt.name,
            icon: 'lucide:message-square',
            type: 'item' as const,
            category: 'prompts' as const,
            description: prompt.description ?? '',
            mcpEntry: prompt
          }))
        )
    },
    { immediate: true }
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
