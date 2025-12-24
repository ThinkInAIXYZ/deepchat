<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import type { MCPServerConfig } from '@shared/presenter'

const props = defineProps<{
  agentId: string
  isBuiltin: boolean
}>()

const emit = defineEmits<{
  'update:selections': [selections: string[]]
}>()

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')

const loading = ref(false)
const saving = ref(false)
const availableServers = ref<Array<{ name: string; config: MCPServerConfig }>>([])
const selections = ref<string[]>([])

const selectableServers = computed(() =>
  availableServers.value.filter((server) => server.config.type !== 'inmemory')
)

const selectionSet = computed(() => new Set(selections.value))

const load = async () => {
  if (!props.agentId) return
  loading.value = true
  try {
    const [servers, currentSelections] = await Promise.all([
      configPresenter.getMcpServers(),
      configPresenter.getAgentMcpSelections(props.agentId, props.isBuiltin)
    ])

    availableServers.value = Object.entries(servers ?? {}).map(([name, config]) => ({
      name,
      config
    }))

    selections.value = Array.isArray(currentSelections) ? currentSelections : []
  } finally {
    loading.value = false
  }
}

const persist = async (nextSelections: string[]) => {
  if (!props.agentId) return
  saving.value = true
  try {
    await configPresenter.setAgentMcpSelections(props.agentId, props.isBuiltin, nextSelections)
    emit('update:selections', nextSelections)
  } finally {
    saving.value = false
  }
}

const toggleServer = async (serverName: string, checked: boolean) => {
  const next = checked
    ? Array.from(new Set([...selections.value, serverName]))
    : selections.value.filter((name) => name !== serverName)
  selections.value = next
  await persist(next)
}

watch(
  () => [props.agentId, props.isBuiltin],
  () => {
    void load()
  }
)

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="space-y-2">
    <div class="text-xs font-semibold text-muted-foreground">
      {{ t('settings.acp.mcpAccessTitle') }}
    </div>

    <div v-if="loading" class="text-xs text-muted-foreground">
      {{ t('settings.acp.loading') }}
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
