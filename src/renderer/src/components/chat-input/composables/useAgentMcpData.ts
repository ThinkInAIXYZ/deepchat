import { computed, ref, watch } from 'vue'
import { useMcpStore } from '@/stores/mcp'
import { useSessionStore } from '@/stores/ui/session'
import { usePresenter } from '@/composables/usePresenter'

const CUSTOM_PROMPTS_CLIENT = 'deepchat/custom-prompts-server'

export function useAgentMcpData() {
  const sessionStore = useSessionStore()
  const mcpStore = useMcpStore()
  const configPresenter = usePresenter('configPresenter')
  const activeSelections = ref<string[] | null>(null)
  let requestSeq = 0

  const isAcpMode = computed(() => sessionStore.activeSession?.providerId === 'acp')
  const activeAcpAgentId = computed(() =>
    isAcpMode.value ? (sessionStore.activeSession?.modelId?.trim() ?? '') : ''
  )

  watch(
    [isAcpMode, activeAcpAgentId],
    async ([acpMode, agentId]) => {
      const seq = ++requestSeq
      if (!acpMode || !agentId) {
        activeSelections.value = null
        return
      }

      try {
        const selections = await configPresenter.getAgentMcpSelections(agentId)
        if (seq !== requestSeq) return
        activeSelections.value = Array.isArray(selections) ? selections : []
      } catch (error) {
        if (seq !== requestSeq) return
        console.warn('[useAgentMcpData] Failed to load ACP agent MCP selections:', error)
        activeSelections.value = []
      }
    },
    { immediate: true }
  )

  const selectionSet = computed(() => {
    const selections = activeSelections.value
    if (!isAcpMode.value || !selections?.length) return null
    return new Set(selections)
  })

  const tools = computed(() => {
    if (!isAcpMode.value) return mcpStore.tools
    const set = selectionSet.value
    if (!set) return []
    return mcpStore.tools.filter((tool) => set.has(tool.server.name))
  })

  const resources = computed(() => {
    if (!isAcpMode.value) return mcpStore.resources
    const set = selectionSet.value
    if (!set) return []
    return mcpStore.resources.filter((resource) => set.has(resource.client.name))
  })

  const prompts = computed(() => {
    if (!isAcpMode.value) return mcpStore.prompts
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
