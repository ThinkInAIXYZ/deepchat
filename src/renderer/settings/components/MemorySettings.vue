<template>
  <SettingsPageShell
    :title="t('routes.settings-memory')"
    :eyebrow="t('settings.controlCenter.groups.knowledge')"
    :description="t('settings.memory.description')"
    data-testid="settings-memory-page"
  >
    <div v-if="loading" class="py-16 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="loadError"
      class="space-y-3 rounded-2xl border border-destructive/40 py-10 text-center text-sm text-destructive"
    >
      <div>{{ loadError }}</div>
      <Button variant="outline" size="sm" @click="() => reload()">
        {{ t('common.reset') }}
      </Button>
    </div>

    <div
      v-else-if="agents.length === 0"
      class="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground"
    >
      {{ t('settings.memory.empty') }}
    </div>

    <div v-else class="flex w-full flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] font-medium text-muted-foreground">
          {{ t('settings.memory.agentPicker') }}
        </span>
        <div class="w-full sm:max-w-xs">
          <Select :model-value="selectedAgentId" @update:model-value="onSelect">
            <SelectTrigger data-testid="settings-memory-agent-picker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="agent in agents" :key="agent.id" :value="agent.id">
                {{ agentLabel(agent) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="config">{{ t('settings.memory.tabConfig') }}</TabsTrigger>
          <TabsTrigger value="manage">{{ t('settings.memory.tabManage') }}</TabsTrigger>
        </TabsList>

        <TabsContent value="config" class="mt-4">
          <MemoryConfigPanel
            :key="`config-${selectedAgentId}`"
            :agent-id="selectedAgentId"
            @saved="onSaved"
          />
        </TabsContent>

        <TabsContent value="manage" class="mt-4">
          <MemoryManagerPanel
            :key="`manage-${selectedAgentId}`"
            :agent-id="selectedAgentId"
            :memory-enabled="memoryEnabled"
            :has-embedding-configured="hasEmbeddingConfigured"
            :persona-evolution-enabled="personaEvolutionEnabled"
          />
        </TabsContent>
      </Tabs>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { createConfigClient } from '@api/ConfigClient'
import { Button } from '@shadcn/components/ui/button'
import type { Agent, DeepChatAgentConfig } from '@shared/types/agent-interface'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import MemoryConfigPanel from './MemoryConfigPanel.vue'
import MemoryManagerPanel from './MemoryManagerPanel.vue'

const BUILTIN_DEEPCHAT_AGENT_ID = 'deepchat'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const configClient = createConfigClient()

const loading = ref(true)
const agents = ref<Agent[]>([])
const selectedAgentId = ref('')
const activeTab = ref<'config' | 'manage'>('config')
const resolvedSelected = ref<DeepChatAgentConfig | null>(null)
const resolvedAgentId = ref('')
const loadError = ref<string | null>(null)

// Resolved config describes the selected agent only once its own resolve has landed. Mid-switch the
// manager panel remounts on the new agentId immediately, so these flags must not leak the previous
// agent's values until the new resolve commits — otherwise a disabled agent briefly looks writable.
const configReady = computed(() => resolvedAgentId.value === selectedAgentId.value)
const memoryEnabled = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.memoryEnabled)
)
const hasEmbeddingConfigured = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.memoryEmbedding)
)
const personaEvolutionEnabled = computed(
  () => configReady.value && Boolean(resolvedSelected.value?.personaEvolutionEnabled)
)

function agentLabel(agent: Agent): string {
  return agent.id === BUILTIN_DEEPCHAT_AGENT_ID
    ? agent.name || t('routes.settings-memory')
    : agent.name
}

async function loadAgents(preferred?: string | null): Promise<void> {
  const list = await configClient.listAgents()
  agents.value = list
    .filter((agent) => agent.type === 'deepchat')
    .sort((a, b) =>
      a.id === BUILTIN_DEEPCHAT_AGENT_ID
        ? -1
        : b.id === BUILTIN_DEEPCHAT_AGENT_ID
          ? 1
          : a.name.localeCompare(b.name)
    )
  const ids = new Set(agents.value.map((agent) => agent.id))
  selectedAgentId.value =
    preferred && ids.has(preferred)
      ? preferred
      : selectedAgentId.value && ids.has(selectedAgentId.value)
        ? selectedAgentId.value
        : ids.has(BUILTIN_DEEPCHAT_AGENT_ID)
          ? BUILTIN_DEEPCHAT_AGENT_ID
          : (agents.value[0]?.id ?? '')
}

async function loadResolved(): Promise<void> {
  const agentId = selectedAgentId.value
  if (!agentId) {
    resolvedSelected.value = null
    resolvedAgentId.value = ''
    return
  }
  try {
    const config = await configClient.resolveDeepChatAgentConfig(agentId)
    // A newer switch may have superseded this resolve; never let a late response clobber the
    // current agent's flags.
    if (selectedAgentId.value !== agentId) return
    resolvedSelected.value = config
    resolvedAgentId.value = agentId
  } catch {
    if (selectedAgentId.value !== agentId) return
    resolvedSelected.value = null
    resolvedAgentId.value = agentId
  }
}

function onSelect(value: unknown): void {
  const id = typeof value === 'string' ? value : ''
  if (!id || id === selectedAgentId.value) return
  selectedAgentId.value = id
  void router.replace({ query: { ...route.query, agentId: id } })
}

async function reload(preferred?: string | null): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    await loadAgents(preferred ?? selectedAgentId.value)
    await loadResolved()
  } catch (e) {
    agents.value = []
    resolvedSelected.value = null
    resolvedAgentId.value = ''
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function onSaved(): Promise<void> {
  await reload(selectedAgentId.value)
}

watch(selectedAgentId, loadResolved)
watch(
  () => route.query.agentId,
  (value) => {
    if (typeof value === 'string' && agents.value.some((agent) => agent.id === value)) {
      selectedAgentId.value = value
    }
  }
)

onMounted(() => {
  const fromQuery = typeof route.query.agentId === 'string' ? route.query.agentId : null
  void reload(fromQuery)
})
</script>
