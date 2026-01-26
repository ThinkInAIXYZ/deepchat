import { computed } from 'vue'
import { useMcpStore } from '@/stores/mcp'

/**
 * Agent MCP Data Composable (Phase 6: chatConfig removed)
 * All MCP tools/resources/prompts are now available by default
 */
export function useAgentMcpData() {
  const mcpStore = useMcpStore()

  // All tools are available (ACP mode removed in Phase 6)
  const tools = computed(() => mcpStore.tools)

  // All resources are available
  const resources = computed(() => mcpStore.resources)

  // All prompts are available
  const prompts = computed(() => mcpStore.prompts)

  return {
    tools,
    resources,
    prompts
  }
}
