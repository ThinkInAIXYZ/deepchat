<template>
  <div class="flex h-full w-full flex-col">
    <div class="shrink-0 border-b px-4 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ t('settings.agents.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('settings.agents.description') }}</p>
        </div>

        <Button type="button" :disabled="loading" @click="openCreateDialog">
          <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
          {{ t('settings.agents.newAgent') }}
        </Button>
      </div>

      <div class="mt-3">
        <Input
          v-model="searchKeyword"
          :placeholder="t('settings.agents.searchPlaceholder')"
          class="h-9"
        />
      </div>

      <p v-if="errorMessage" class="mt-2 text-sm text-destructive">
        {{ errorMessage }}
      </p>
    </div>

    <ScrollArea class="h-0 flex-1">
      <div class="p-4">
        <AgentList
          :loading="loading"
          :template-agents="filteredTemplateAgents"
          :acp-agents="filteredAcpAgents"
          :provider-label-map="providerLabelMap"
          :model-label-map="modelLabelMap"
          :workdir-map="workdirMap"
          @edit-template="openEditDialog"
          @delete-template="deleteTemplateAgent"
          @view-acp="goToAcpSettings"
        />
      </div>
    </ScrollArea>
  </div>

  <AgentEditorDialog
    :open="editorOpen"
    :mode="editingAgent ? 'edit' : 'create'"
    :saving="saving"
    :agent="editingAgent"
    :initial-workdir="editingAgentWorkdir"
    :providers="editorProviders"
    :models-by-provider="editorModelsByProvider"
    :recent-workdirs="recentWorkdirs"
    @update:open="handleEditorOpenChange"
    @submit="submitAgent"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import type { Agent, TemplateAgent } from '@shared/presenter'
import AgentList from './AgentList.vue'
import AgentEditorDialog, { type AgentEditorSubmitPayload } from './AgentEditorDialog.vue'

const DEFAULT_AGENT_ID = 'default-local-agent'
const AGENT_WORKDIR_MAP_KEY = 'agentWorkdirMap'

const { t } = useI18n()
const router = useRouter()
const { toast } = useToast()

const agentConfigPresenter = usePresenter('agentConfigPresenter')
const configPresenter = usePresenter('configPresenter')

const providerStore = useProviderStore()
const modelStore = useModelStore()

const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const agents = ref<Agent[]>([])
const workdirMap = ref<Record<string, string>>({})
const recentWorkdirs = ref<string[]>([])
const searchKeyword = ref('')

const editorOpen = ref(false)
const editingAgent = ref<TemplateAgent | null>(null)

const providerLabelMap = computed<Record<string, string>>(() => {
  return providerStore.providers.reduce<Record<string, string>>((acc, provider) => {
    acc[provider.id] = provider.name || provider.id
    return acc
  }, {})
})

const modelLabelMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}

  for (const providerModels of modelStore.allProviderModels) {
    for (const model of providerModels.models) {
      map[`${providerModels.providerId}::${model.id}`] = model.name || model.id
    }
  }

  return map
})

const editorProviders = computed(() => {
  return providerStore.providers
    .filter((provider) => provider.id !== 'acp')
    .map((provider) => ({
      id: provider.id,
      name: provider.name || provider.id
    }))
})

const editorModelsByProvider = computed<Record<string, Array<{ id: string; name: string }>>>(() => {
  const map: Record<string, Array<{ id: string; name: string }>> = {}

  for (const provider of editorProviders.value) {
    const source = modelStore.allProviderModels.find((item) => item.providerId === provider.id)
    map[provider.id] =
      source?.models.map((model) => ({
        id: model.id,
        name: model.name || model.id
      })) || []
  }

  return map
})

const keyword = computed(() => searchKeyword.value.trim().toLowerCase())

const filteredTemplateAgents = computed(() => {
  return agents.value
    .filter((agent): agent is TemplateAgent => agent.type === 'template')
    .filter((agent) => {
      if (!keyword.value) return true

      const workdir = workdirMap.value[agent.id] || ''
      return [agent.name, agent.providerId, agent.modelId, workdir]
        .join(' ')
        .toLowerCase()
        .includes(keyword.value)
    })
})

const filteredAcpAgents = computed(() => {
  return agents.value
    .filter((agent): agent is Extract<Agent, { type: 'acp' }> => agent.type === 'acp')
    .filter((agent) => {
      if (!keyword.value) return true
      return [agent.name, agent.command].join(' ').toLowerCase().includes(keyword.value)
    })
})

const editingAgentWorkdir = computed(() => {
  if (!editingAgent.value) return ''
  return workdirMap.value[editingAgent.value.id] || ''
})

const loadAgentSettings = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    if (providerStore.providers.length === 0) {
      await providerStore.initialize()
    }

    if (modelStore.allProviderModels.length === 0) {
      await modelStore.refreshAllModels()
    }

    const [loadedAgents, loadedWorkdirMap, loadedRecentWorkdirs] = await Promise.all([
      agentConfigPresenter.getAgents(),
      configPresenter.getSetting<Record<string, string>>(AGENT_WORKDIR_MAP_KEY),
      configPresenter.getRecentWorkdirs()
    ])

    agents.value = Array.isArray(loadedAgents) ? loadedAgents : []
    workdirMap.value =
      loadedWorkdirMap && typeof loadedWorkdirMap === 'object' && !Array.isArray(loadedWorkdirMap)
        ? loadedWorkdirMap
        : {}
    recentWorkdirs.value = Array.isArray(loadedRecentWorkdirs) ? loadedRecentWorkdirs : []
  } catch (error) {
    console.error('[AgentSettings] Failed to load agents', error)
    errorMessage.value = t('settings.agents.loadError')
  } finally {
    loading.value = false
  }
}

const persistAgentWorkdir = async (agentId: string, workdir: string | null) => {
  const nextMap = { ...workdirMap.value }
  const normalized = workdir?.trim() || ''

  if (normalized) {
    nextMap[agentId] = normalized
    await configPresenter.addRecentWorkdir(normalized)
  } else {
    delete nextMap[agentId]
  }

  await configPresenter.setSetting(AGENT_WORKDIR_MAP_KEY, nextMap)
  workdirMap.value = nextMap
  recentWorkdirs.value = await configPresenter.getRecentWorkdirs()
}

const openCreateDialog = () => {
  editingAgent.value = null
  editorOpen.value = true
}

const openEditDialog = (agent: TemplateAgent) => {
  editingAgent.value = agent
  editorOpen.value = true
}

const handleEditorOpenChange = (next: boolean) => {
  editorOpen.value = next
  if (!next) {
    editingAgent.value = null
  }
}

const submitAgent = async (payload: AgentEditorSubmitPayload) => {
  saving.value = true
  try {
    if (editingAgent.value) {
      await agentConfigPresenter.updateAgent(editingAgent.value.id, {
        name: payload.name,
        icon: payload.icon,
        providerId: payload.providerId,
        modelId: payload.modelId,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      })

      await persistAgentWorkdir(editingAgent.value.id, payload.workdir)
    } else {
      const createdId = await agentConfigPresenter.createAgent({
        type: 'template',
        name: payload.name,
        icon: payload.icon,
        providerId: payload.providerId,
        modelId: payload.modelId,
        systemPrompt: payload.systemPrompt,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      })

      await persistAgentWorkdir(createdId, payload.workdir)
    }

    editorOpen.value = false
    editingAgent.value = null
    await loadAgentSettings()
  } catch (error) {
    console.error('[AgentSettings] Failed to save agent', error)
    toast({
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed'),
      variant: 'destructive'
    })
  } finally {
    saving.value = false
  }
}

const deleteTemplateAgent = async (agent: TemplateAgent) => {
  if (agent.id === DEFAULT_AGENT_ID) {
    toast({
      title: t('common.error.operationFailed'),
      description: t('settings.agents.defaultAgentDeleteBlocked'),
      variant: 'destructive'
    })
    return
  }

  const confirmed = window.confirm(t('settings.agents.deleteConfirm', { name: agent.name }))
  if (!confirmed) return

  try {
    await agentConfigPresenter.deleteAgent(agent.id)

    const nextMap = { ...workdirMap.value }
    delete nextMap[agent.id]
    await configPresenter.setSetting(AGENT_WORKDIR_MAP_KEY, nextMap)
    workdirMap.value = nextMap

    await loadAgentSettings()
  } catch (error) {
    console.error('[AgentSettings] Failed to delete agent', error)
    toast({
      title: t('common.error.operationFailed'),
      description: t('common.error.requestFailed'),
      variant: 'destructive'
    })
  }
}

const goToAcpSettings = async () => {
  await router.push({ name: 'settings-acp' })
}

onMounted(() => {
  void loadAgentSettings()
})
</script>
