import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAcpEventsAdapter } from '@/composables/acp/useAcpEventsAdapter'
import type { Ref } from 'vue'
import type { SessionUpdatedEvent } from '@shared/types/presenters/agentic.presenter.d'

type ActiveModelRef = Ref<{ id?: string; providerId?: string } | null>

interface UseAcpCommandsOptions {
  activeModel: ActiveModelRef
  conversationId: Ref<string | null>
}

export interface AcpCommand {
  name: string
  description?: string
  input?: { hint: string } | null
}

export function useAcpCommands(options: UseAcpCommandsOptions) {
  const availableCommands = ref<AcpCommand[]>([])
  const acpEventsAdapter = useAcpEventsAdapter()
  let unsubscribeCommandsUpdate: (() => void) | null = null

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )
  const agentId = computed(() => options.activeModel.value?.id ?? '')

  /**
   * Whether the agent has declared any available commands.
   */
  const hasCommands = computed(() => availableCommands.value.length > 0)

  /**
   * Clear commands when agent changes
   */
  watch(agentId, (newId, oldId) => {
    if (!newId || newId === oldId) return
    availableCommands.value = []
  })

  /**
   * Clear commands when switching away from ACP model
   */
  watch(isAcpModel, (isAcp) => {
    if (!isAcp) {
      availableCommands.value = []
    }
  })

  /**
   * Listen for session updated event from agentic presenter
   * Checks for availableCommands in sessionInfo to detect command updates
   */
  const handleSessionUpdated = (payload: SessionUpdatedEvent) => {
    if (!isAcpModel.value || !payload.sessionInfo.availableCommands) return

    const conversationMatch = payload.sessionId === options.conversationId.value
    const agentMatch = payload.sessionInfo.agentId === options.activeModel.value?.id

    if (conversationMatch || agentMatch) {
      // Map SessionInfo commands to AcpCommand format
      const commands: AcpCommand[] = payload.sessionInfo.availableCommands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        input: cmd.inputHint ? { hint: cmd.inputHint } : null
      }))

      console.info(
        `[useAcpCommands] Received commands from main: [${commands.map((c) => c.name).join(', ')}]`
      )
      availableCommands.value = commands
    }
  }

  onMounted(() => {
    unsubscribeCommandsUpdate = acpEventsAdapter.subscribeSessionUpdated(handleSessionUpdated)
  })

  onUnmounted(() => {
    unsubscribeCommandsUpdate?.()
    unsubscribeCommandsUpdate = null
  })

  /**
   * Get a command by name
   */
  const getCommand = (name: string): AcpCommand | undefined => {
    return availableCommands.value.find((cmd) => cmd.name === name)
  }

  /**
   * Clear all commands (useful when conversation ends or agent changes)
   */
  const clearCommands = () => {
    availableCommands.value = []
  }

  return {
    isAcpModel,
    availableCommands,
    hasCommands,
    getCommand,
    clearCommands
  }
}
