<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createConfigClient } from '@api/ConfigClient'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Button } from '@shadcn/components/ui/button'
import { nanoid } from 'nanoid'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'

const emit = defineEmits<{
  'update:selections': [selections: string[]]
  'persistence-state': [state: 'idle' | 'saving' | 'retryable']
}>()

const { t } = useI18n()
const configClient = createConfigClient()
const saveFeedbackController = createRendererSurfaceFeedbackController('settings')
const { snapshot: saveFeedback } = useSurfaceFeedback(saveFeedbackController)
const saveOperationId = `settings.agentMcpSelections.save:${nanoid(8)}`

type AgentMcpServerConfig = {
  type?: string
  source?: string
  ownerPluginId?: string
}

const loading = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
const availableServers = ref<Array<{ name: string; config: AgentMcpServerConfig }>>([])
const selections = ref<string[]>([])
const retrySelections = ref<string[] | null>(null)
const persistenceState = computed<'idle' | 'saving' | 'retryable'>(() =>
  saving.value ? 'saving' : retrySelections.value ? 'retryable' : 'idle'
)

const selectableServers = computed(() =>
  availableServers.value.filter((server) => server.config.type !== 'inmemory')
)

const selectionSet = computed(() => new Set(selections.value))

const isPluginOwnedServerConfig = (config: AgentMcpServerConfig): boolean =>
  Boolean(config.ownerPluginId || config.source === 'plugin')

const load = async () => {
  if (loading.value) return
  loading.value = true
  loadError.value = null
  try {
    const [servers, currentSelections] = (await Promise.all([
      configClient.getMcpServers(),
      configClient.getAcpSharedMcpSelections()
    ])) as [Record<string, AgentMcpServerConfig>, string[]]

    availableServers.value = Object.entries(servers ?? {})
      .filter(([, config]) => !isPluginOwnedServerConfig(config))
      .map(([name, config]) => ({
        name,
        config
      }))

    const visibleServerNames = new Set(availableServers.value.map((server) => server.name))
    selections.value = Array.isArray(currentSelections)
      ? currentSelections.filter((serverName) => visibleServerNames.has(serverName))
      : []
  } catch (error) {
    console.error('[AgentMcpSelector] Failed to load MCP selections:', error)
    loadError.value = t('common.error.requestFailed')
  } finally {
    loading.value = false
  }
}

const persist = async (
  nextSelections: string[],
  previousSelections: string[] = selections.value
) => {
  if (saving.value) return false
  saving.value = true
  saveFeedbackController.begin(saveOperationId, t('common.saving'))
  try {
    await configClient.setAcpSharedMcpSelections(nextSelections)
    retrySelections.value = null
    emit('update:selections', nextSelections)
    saveFeedbackController.succeed({
      code: 'settings.agentMcpSelections.saved',
      title: t('common.saved')
    })
    return true
  } catch (error) {
    console.error('[AgentMcpSelector] Failed to save MCP selections:', error)
    selections.value = previousSelections
    retrySelections.value = [...nextSelections]
    emit('update:selections', previousSelections)
    saveFeedbackController.fail({
      code: 'settings.agentMcpSelections.saveFailed',
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed')
    })
    return false
  } finally {
    saving.value = false
  }
}

const toggleServer = async (serverName: string, checked: boolean) => {
  if (saving.value) return
  const prev = [...selections.value]
  const next = checked
    ? Array.from(new Set([...selections.value, serverName]))
    : selections.value.filter((name) => name !== serverName)
  selections.value = next
  await persist(next, prev)
}

const retrySave = async () => {
  const next = retrySelections.value
  if (!next || saving.value) return
  const previous = [...selections.value]
  selections.value = [...next]
  await persist(next, previous)
}

const discardRetryIntent = () => {
  if (!retrySelections.value) return
  retrySelections.value = null
  if (saveFeedback.value.status === 'success' || saveFeedback.value.status === 'error') {
    saveFeedbackController.clearSettled()
  }
}

defineExpose({ discardRetryIntent })

onMounted(() => {
  void load()
})

const stopPersistenceStateSync = watch(
  persistenceState,
  (state) => {
    emit('persistence-state', state)
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopPersistenceStateSync()
  emit('persistence-state', 'idle')
})
</script>

<template>
  <div class="space-y-2">
    <div class="flex min-w-0 items-center justify-between gap-3">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('settings.acp.mcpAccessTitle') }}
      </div>
      <InlineOperationFeedback
        :snapshot="saveFeedback"
        :retry-label="t('common.retry')"
        @retry="retrySave"
      />
    </div>

    <div v-if="loading" class="text-xs text-muted-foreground">
      {{ t('settings.acp.loading') }}
    </div>

    <div v-else-if="loadError" role="alert" class="flex items-center justify-between gap-3">
      <span class="text-xs text-destructive">{{ loadError }}</span>
      <Button size="sm" variant="outline" @click="load">
        {{ t('common.retry') }}
      </Button>
    </div>

    <div v-else-if="selectableServers.length === 0" class="text-xs text-muted-foreground">
      {{ t('settings.acp.mcpAccessEmpty') }}
    </div>

    <div v-else class="max-h-56 overflow-y-auto pr-1">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          v-for="server in selectableServers"
          :key="server.name"
          class="flex items-center gap-2 rounded-md border px-3 py-2"
        >
          <Checkbox
            :checked="selectionSet.has(server.name)"
            :disabled="saving"
            @update:checked="(value) => toggleServer(server.name, Boolean(value))"
          />
          <div class="min-w-0 text-sm font-medium truncate" :title="server.name">
            {{ server.name }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
