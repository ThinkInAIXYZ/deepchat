import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useMcpStore } from '@/stores/mcp'

const CUSTOM_PROMPTS_CLIENT = 'deepchat/custom-prompts-server'

export function useAgentMcpData() {
  const chatStore = useChatStore()
  const mcpStore = useMcpStore()

  const selectionSet = computed(() => {
    const selections = chatStore.activeAgentMcpSelections
    if (!chatStore.isAcpMode || !selections?.length) return null
    return new Set(selections)
  })

  const tools = computed(() => {
    if (!chatStore.isAcpMode) return mcpStore.tools
    const set = selectionSet.value
    if (!set) return []
    return mcpStore.tools.filter((tool) => set.has(tool.server.name))
  })

  const resources = computed(() => {
    if (!chatStore.isAcpMode) return mcpStore.resources
    const set = selectionSet.value
    if (!set) return []
    return mcpStore.resources.filter((resource) => set.has(resource.client.name))
  })

  const prompts = computed(() => {
    if (!chatStore.isAcpMode) return mcpStore.prompts
    const set = selectionSet.value
    if (!set)
      return mcpStore.prompts.filter((prompt) => prompt.client?.name === CUSTOM_PROMPTS_CLIENT)
    return mcpStore.prompts.filter(
      (prompt) => prompt.client?.name === CUSTOM_PROMPTS_CLIENT || set.has(prompt.client?.name)
    )
  })

  return {
    tools,
    resources,
    prompts,
    selectionSet
  }
}
