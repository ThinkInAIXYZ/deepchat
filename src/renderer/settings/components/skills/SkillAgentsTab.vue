<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-medium">{{ t('settings.skills.agents.title') }}</h3>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.skills.agents.summary', { count: agents.length }) }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="loading" @click="loadAgents">
          <Icon
            icon="lucide:refresh-cw"
            class="w-4 h-4 mr-1"
            :class="{ 'animate-spin': loading }"
          />
          {{ t('settings.skills.agents.refresh') }}
        </Button>
      </div>
    </div>

    <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
      <div class="font-medium text-destructive">{{ t('settings.skills.agents.loadFailed') }}</div>
      <div class="mt-1 text-xs text-muted-foreground">{{ error }}</div>
    </div>

    <div v-if="loading && agents.length === 0" class="space-y-2 animate-pulse">
      <div v-for="index in 3" :key="index" class="h-10 rounded-md bg-muted/50"></div>
    </div>

    <div v-else-if="agents.length === 0" class="py-10 text-center">
      <Icon icon="lucide:scan-search" class="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
      <p class="text-sm text-muted-foreground">
        {{ t('settings.skills.agents.empty') }}
      </p>
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="agent in agents"
          :key="agent.id"
          type="button"
          variant="outline"
          class="h-12 min-w-48 justify-start gap-2"
          :class="{ 'border-primary bg-primary/5': agent.id === selectedAgentId }"
          @click="selectAgent(agent.id)"
        >
          <Icon :icon="agentIcon(agent.id)" class="h-5 w-5 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left">{{ agent.name }}</span>
          <Badge variant="outline" class="ml-2 text-[11px]">
            {{ agent.skillsCount }}
          </Badge>
          <Badge v-if="agent.conflictCount" variant="outline" class="ml-1 text-[11px]">
            {{ t('settings.skills.agents.conflictCount', { count: agent.conflictCount }) }}
          </Badge>
        </Button>
      </div>

      <div v-if="selectedAgent" class="space-y-3">
        <div class="rounded-md border px-3 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="truncate text-sm font-medium">{{ selectedAgent.name }}</h4>
                <Badge variant="outline" :class="agentStatusClass(selectedAgent.status)">
                  {{ t(`settings.skills.agents.agentStatus.${selectedAgent.status}`) }}
                </Badge>
              </div>
              <p
                class="mt-1 truncate text-xs text-muted-foreground"
                :title="selectedAgent.skillsDir"
              >
                {{ selectedAgent.skillsDir }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{{
              t('settings.skills.agents.counts.skills', { count: selectedAgent.skillsCount })
            }}</span>
            <span>{{
              t('settings.skills.agents.counts.linked', { count: selectedAgent.linkedCount })
            }}</span>
            <span>
              {{
                t('settings.skills.agents.counts.agentOwned', {
                  count: selectedAgent.agentOwnedCount
                })
              }}
            </span>
            <span>{{
              t('settings.skills.agents.counts.conflicts', { count: selectedAgent.conflictCount })
            }}</span>
            <span>{{
              t('settings.skills.agents.counts.broken', { count: selectedAgent.brokenLinkCount })
            }}</span>
          </div>
        </div>

        <div v-if="detailLoading" class="h-24 rounded-md bg-muted/50 animate-pulse"></div>
        <AgentSkillTable
          v-else
          :agent="selectedAgent"
          @action="handleAgentSkillAction"
          @view-detail="openAgentSkillDetail"
        />
      </div>
    </template>

    <AdoptSkillDialog
      v-model:open="adoptDialogOpen"
      :preview="adoptPreview"
      :loading="adoptLoading"
      :executing="adoptExecuting"
      :error="adoptError"
      @confirm="executeAdoption"
    />

    <SkillDetailDialog
      v-model:open="detailDialogOpen"
      :name="skillDetail?.name ?? ''"
      :description="skillDetail?.description"
      :source-path="skillDetail?.sourcePath"
      :markdown="skillDetail?.markdown"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { createSkillSyncClient } from '@api/SkillSyncClient'
import type {
  AdoptAgentSkillInput,
  AdoptAgentSkillPreview,
  AgentSkillItem,
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  SkillDetail
} from '@shared/types/skillSync'
import AdoptSkillDialog from './AdoptSkillDialog.vue'
import AgentSkillTable from './AgentSkillTable.vue'
import SkillDetailDialog from './SkillDetailDialog.vue'

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const skillSyncClient = createSkillSyncClient()

const loading = ref(false)
const detailLoading = ref(false)
const error = ref<string | null>(null)
const agents = ref<InstalledSkillAgent[]>([])
const selectedAgentId = ref<string | null>(null)
const selectedAgentDetail = ref<InstalledSkillAgentDetail | null>(null)
const adoptDialogOpen = ref(false)
const adoptPreview = ref<AdoptAgentSkillPreview | null>(null)
const adoptLoading = ref(false)
const adoptExecuting = ref(false)
const adoptError = ref<string | null>(null)
const pendingAdoptInput = ref<AdoptAgentSkillInput | null>(null)
const detailDialogOpen = ref(false)
const skillDetail = ref<SkillDetail | null>(null)

const selectedAgent = computed(() => selectedAgentDetail.value)

const loadAgents = async () => {
  loading.value = true
  error.value = null
  try {
    agents.value = await skillSyncClient.scanAgents()
    const nextId =
      agents.value.find((agent) => agent.id === selectedAgentId.value)?.id ?? agents.value[0]?.id
    selectedAgentId.value = nextId ?? null
    if (nextId) {
      await loadAgentDetail(nextId)
    } else {
      selectedAgentDetail.value = null
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

const loadAgentDetail = async (agentId: string) => {
  detailLoading.value = true
  error.value = null
  try {
    selectedAgentDetail.value = await skillSyncClient.getAgentDetail(agentId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    detailLoading.value = false
  }
}

const selectAgent = async (agentId: string) => {
  selectedAgentId.value = agentId
  await loadAgentDetail(agentId)
}

const openAdoptDialog = async (skill: AgentSkillItem) => {
  const agentId = selectedAgent.value?.id
  if (!agentId) return

  const input: AdoptAgentSkillInput = {
    agentId,
    skillName: skill.name
  }
  pendingAdoptInput.value = input
  adoptPreview.value = null
  adoptError.value = null
  adoptDialogOpen.value = true
  adoptLoading.value = true

  try {
    adoptPreview.value = await skillSyncClient.previewAdoptAgentSkill(input)
  } catch (cause) {
    adoptError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    adoptLoading.value = false
  }
}

const handleAgentSkillAction = async (skill: AgentSkillItem) => {
  if (skill.action === 'adopt' || skill.action === 'resolve-conflict') {
    await openAdoptDialog(skill)
    return
  }
  if (skill.action === 'repair-link') {
    await executeAgentLinkAction(skill, 'repair')
    return
  }
  if (skill.action === 'remove-link') {
    await executeAgentLinkAction(skill, 'remove')
  }
}

const openAgentSkillDetail = async (skill: AgentSkillItem) => {
  const agentId = selectedAgent.value?.id
  if (!agentId) return
  try {
    skillDetail.value = await skillSyncClient.getAgentSkillDetail(agentId, skill.name)
    detailDialogOpen.value = true
  } catch (cause) {
    toast({
      title: t('settings.skills.detail.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  }
}

const handleLinkChanged = async () => {
  await Promise.all([loadAgents(), skillsStore.loadSkills()])
}

const executeAgentLinkAction = async (skill: AgentSkillItem, action: 'repair' | 'remove') => {
  const agentId = selectedAgent.value?.id
  if (!agentId) return

  try {
    const result =
      action === 'repair'
        ? await skillSyncClient.repairAgentSkillLink({ agentId, skillName: skill.name })
        : await skillSyncClient.removeAgentSkillLink({ agentId, skillName: skill.name })
    if (!result.success) {
      throw new Error(result.error || t('settings.skills.agents.linkAction.failed'))
    }
    toast({
      title: t(`settings.skills.agents.linkAction.${action}Success`),
      description: t('settings.skills.agents.linkAction.successDescription', {
        name: skill.name
      })
    })
    await handleLinkChanged()
  } catch (cause) {
    toast({
      title: t('settings.skills.agents.linkAction.failed'),
      description: cause instanceof Error ? cause.message : String(cause),
      variant: 'destructive'
    })
  }
}

const executeAdoption = async () => {
  if (!pendingAdoptInput.value || !adoptPreview.value) return

  adoptExecuting.value = true
  adoptError.value = null
  try {
    const input: AdoptAgentSkillInput = {
      ...pendingAdoptInput.value,
      targetName: adoptPreview.value.targetName
    }
    const result = await skillSyncClient.executeAdoptAgentSkill(input)
    if (!result.success) {
      throw new Error(result.error || t('settings.skills.agents.adoptDialog.executeFailed'))
    }

    adoptDialogOpen.value = false
    toast({
      title: t('settings.skills.agents.adoptDialog.successTitle'),
      description: t('settings.skills.agents.adoptDialog.successDescription', {
        name: result.skillName ?? input.targetName ?? input.skillName
      })
    })
    await handleLinkChanged()
  } catch (cause) {
    adoptError.value = cause instanceof Error ? cause.message : String(cause)
    toast({
      title: t('settings.skills.agents.adoptDialog.executeFailed'),
      description: adoptError.value,
      variant: 'destructive'
    })
  } finally {
    adoptExecuting.value = false
  }
}

const agentStatusClass = (status: InstalledSkillAgent['status']) => {
  if (status === 'ready') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  if (status === 'permission-denied') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  return ''
}

const agentIcon = (id: string) => {
  if (id === 'codex') return 'simple-icons:openai'
  if (id === 'claude-code') return 'simple-icons:anthropic'
  if (id === 'cursor') return 'simple-icons:cursor'
  if (id === 'opencode') return 'lucide:code-2'
  if (id === 'goose') return 'lucide:feather'
  if (id === 'kilocode') return 'lucide:binary'
  if (id === 'copilot-user') return 'simple-icons:github'
  return 'lucide:bot'
}

onMounted(loadAgents)
</script>
