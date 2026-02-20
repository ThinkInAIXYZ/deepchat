import { ref, computed, onMounted } from 'vue'
import { useAgentStore, type LocalAgentEntry } from '@/stores/agent'
import { useChatStore } from '@/stores/chat'
import { usePresenter } from '@/composables/usePresenter'
import type { Agent, TemplateAgent, AcpAgent } from '@shared/types/presenters/agentConfig.presenter'
import type { UserMessageContent } from '@shared/chat'

type SelectedAgent = Agent | LocalAgentEntry | null

export function useNewThread() {
  const agentStore = useAgentStore()
  const chatStore = useChatStore()
  const configP = usePresenter('configPresenter')
  const deviceP = usePresenter('devicePresenter')

  const workdir = ref<string>('')
  const userInput = ref('')
  const loading = ref(false)
  const recentWorkdirs = ref<string[]>([])

  const selectedAgent = computed<SelectedAgent>(() => agentStore.selectedAgent)

  const displayWorkdir = computed(() => {
    const path = workdir.value
    if (!path) return ''
    const parts = path.split('/')
    if (parts.length > 3) {
      return '.../' + parts.slice(-2).join('/')
    }
    return path
  })

  async function loadRecentWorkdirs() {
    try {
      recentWorkdirs.value = await configP.getRecentWorkdirs()
    } catch (error) {
      console.warn('Failed to load recent workdirs:', error)
      recentWorkdirs.value = []
    }
  }

  async function selectWorkdir(path: string) {
    workdir.value = path
    if (!path) return

    try {
      await configP.addRecentWorkdir(path)
      await loadRecentWorkdirs()
    } catch (error) {
      console.warn('Failed to save recent workdir:', error)
    }
  }

  async function browseDirectory() {
    try {
      const result = await deviceP.selectDirectory()
      if (!result.canceled && result.filePaths.length > 0) {
        await selectWorkdir(result.filePaths[0])
      }
    } catch (error) {
      console.warn('Failed to browse directory:', error)
    }
  }

  async function handleSubmit(content: UserMessageContent) {
    loading.value = true

    try {
      const agent = selectedAgent.value
      const settings: Record<string, unknown> = {
        agentWorkspacePath: workdir.value || null
      }

      if (agent && agent.type === 'template') {
        const templateAgent = agent as TemplateAgent
        settings.providerId = templateAgent.providerId
        settings.modelId = templateAgent.modelId
        if (templateAgent.systemPrompt) {
          settings.systemPrompt = templateAgent.systemPrompt
        }
        if (templateAgent.temperature !== undefined) {
          settings.temperature = templateAgent.temperature
        }
        if (templateAgent.contextLength !== undefined) {
          settings.contextLength = templateAgent.contextLength
        }
        if (templateAgent.maxTokens !== undefined) {
          settings.maxTokens = templateAgent.maxTokens
        }
        if (templateAgent.thinkingBudget !== undefined) {
          settings.thinkingBudget = templateAgent.thinkingBudget
        }
        if (templateAgent.reasoningEffort !== undefined) {
          settings.reasoningEffort = templateAgent.reasoningEffort
        }
      } else if (agent && agent.type === 'acp') {
        const acpAgent = agent as AcpAgent
        settings.providerId = 'acp'
        settings.modelId = acpAgent.id
        if (workdir.value) {
          settings.acpWorkdirMap = { [acpAgent.id]: workdir.value }
        }
      }

      const threadId = await chatStore.createThread(content.text || 'New Chat', settings)

      if (workdir.value) {
        await configP.addRecentWorkdir(workdir.value)
      }

      await chatStore.sendMessage(content)

      return threadId
    } catch (error) {
      console.error('Failed to create thread:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  onMounted(async () => {
    await agentStore.loadAgents()
    await loadRecentWorkdirs()

    if (!workdir.value && chatStore.chatConfig.agentWorkspacePath) {
      workdir.value = chatStore.chatConfig.agentWorkspacePath
    }
  })

  return {
    selectedAgent,
    workdir,
    displayWorkdir,
    userInput,
    loading,
    recentWorkdirs,
    selectWorkdir,
    browseDirectory,
    handleSubmit,
    loadRecentWorkdirs
  }
}
