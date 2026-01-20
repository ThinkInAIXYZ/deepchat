import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAcpEventsAdapter } from '@/composables/acp/useAcpEventsAdapter'
import type { Ref } from 'vue'

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

  // Listen for commands update event from main process
  const handleCommandsUpdate = (payload: {
    conversationId?: string
    agentId?: string
    commands: AcpCommand[]
  }) => {
    if (!isAcpModel.value) return

    const conversationMatch =
      payload.conversationId && payload.conversationId === options.conversationId.value
    const agentMatch = payload.agentId && payload.agentId === options.activeModel.value?.id

    if (conversationMatch || agentMatch) {
      console.info(
        `[useAcpCommands] Received commands from main: [${payload.commands.map((c) => c.name).join(', ')}]`
      )
      availableCommands.value = payload.commands
    }
  }

  onMounted(() => {
    unsubscribeCommandsUpdate = acpEventsAdapter.subscribeCommandsUpdate(handleCommandsUpdate)
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
