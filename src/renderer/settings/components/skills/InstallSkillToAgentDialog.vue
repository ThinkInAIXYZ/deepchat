<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent v-if="open" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {{ t('settings.skills.installToAgent.title', { name: skill?.name ?? '' }) }}
        </DialogTitle>
        <DialogDescription>
          {{ t('settings.skills.installToAgent.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
          <div class="font-medium text-destructive">
            {{ t('settings.skills.installToAgent.failed') }}
          </div>
          <div class="mt-1 text-xs text-muted-foreground">{{ error }}</div>
        </div>

        <div v-if="loadingAgents" class="space-y-2 animate-pulse">
          <div v-for="index in 3" :key="index" class="h-10 rounded-md bg-muted/50"></div>
        </div>

        <div v-else-if="agents.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          {{ t('settings.skills.installToAgent.emptyAgents') }}
        </div>

        <div v-else class="space-y-3">
          <div class="text-sm font-medium">{{ t('settings.skills.installToAgent.target') }}</div>
          <div class="grid gap-2 sm:grid-cols-2">
            <Button
              v-for="agent in agents"
              :key="agent.id"
              type="button"
              variant="outline"
              class="h-12 justify-start gap-2"
              :class="{ 'border-primary bg-primary/5': selectedAgentId === agent.id }"
              @click="selectedAgentId = agent.id"
            >
              <Icon :icon="agentIcon(agent.id)" class="h-5 w-5 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-left">{{ agent.name }}</span>
              <Badge variant="outline" class="shrink-0 text-[11px]">
                {{ agent.skillsCount }}
              </Badge>
            </Button>
          </div>

          <div class="rounded-md border px-3 py-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium">
                {{ t('settings.skills.installToAgent.preview') }}
              </div>
              <Button variant="ghost" size="sm" :disabled="loadingPreview" @click="loadPreview">
                <Icon
                  icon="lucide:refresh-cw"
                  class="h-4 w-4"
                  :class="{ 'animate-spin': loadingPreview }"
                />
              </Button>
            </div>

            <div
              v-if="loadingPreview"
              class="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Icon icon="lucide:loader-2" class="h-4 w-4 animate-spin" />
              {{ t('settings.skills.installToAgent.loadingPreview') }}
            </div>

            <template v-else-if="previewItem">
              <div class="mt-3 flex items-center justify-between gap-2">
                <div class="min-w-0 truncate text-sm font-medium" :title="previewItem.skillName">
                  {{ previewItem.skillName }}
                </div>
                <Badge variant="outline" :class="statusClass(previewItem.status)">
                  {{ t(`settings.skills.agents.syncDialog.status.${previewItem.status}`) }}
                </Badge>
              </div>
              <div
                class="mt-1 truncate font-mono text-xs text-muted-foreground"
                :title="previewItem.targetPath"
              >
                {{ previewItem.targetPath }}
              </div>
              <p v-if="previewItem.message" class="mt-2 text-xs text-muted-foreground">
                {{ previewItem.message }}
              </p>
            </template>

            <div v-else class="mt-3 text-sm text-muted-foreground">
              {{ t('settings.skills.installToAgent.noPreview') }}
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="ghost" :disabled="executing" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button
          :variant="isDisconnect ? 'outline' : 'default'"
          :disabled="!canExecute"
          @click="execute"
        >
          <Icon v-if="executing" icon="lucide:loader-2" class="mr-1 h-4 w-4 animate-spin" />
          {{ actionLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { useToast } from '@/components/use-toast'
import { createSkillSyncClient } from '@api/SkillSyncClient'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import type {
  InstalledSkillAgent,
  LinkDeepChatSkillPreviewItem,
  LinkDeepChatSkillPreviewStatus
} from '@shared/types/skillSync'

const props = defineProps<{
  open: boolean
  skill: UnifiedSkillItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  completed: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillSyncClient = createSkillSyncClient()

const agents = ref<InstalledSkillAgent[]>([])
const selectedAgentId = ref<string | null>(null)
const previewItem = ref<LinkDeepChatSkillPreviewItem | null>(null)
const loadingAgents = ref(false)
const loadingPreview = ref(false)
const executing = ref(false)
const error = ref<string | null>(null)

const isDisconnect = computed(() => previewItem.value?.status === 'already-linked')
const actionLabel = computed(() =>
  t(
    isDisconnect.value
      ? 'settings.skills.installToAgent.disconnect'
      : 'settings.skills.installToAgent.install'
  )
)

const canExecute = computed(
  () =>
    Boolean(props.skill) &&
    Boolean(selectedAgentId.value) &&
    (previewItem.value?.status === 'ready' || previewItem.value?.status === 'already-linked') &&
    !loadingAgents.value &&
    !loadingPreview.value &&
    !executing.value
)

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

const loadAgents = async () => {
  loadingAgents.value = true
  error.value = null
  try {
    agents.value = (await skillSyncClient.scanAgents()).filter(
      (agent) => agent.supportsLinkManagement && agent.status === 'ready'
    )
    selectedAgentId.value = agents.value[0]?.id ?? null
    await loadPreview()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loadingAgents.value = false
  }
}

const loadPreview = async () => {
  if (!props.skill || !selectedAgentId.value) {
    previewItem.value = null
    return
  }
  loadingPreview.value = true
  error.value = null
  try {
    const preview = await skillSyncClient.previewLinkDeepChatSkills({
      agentId: selectedAgentId.value,
      skillNames: [props.skill.name]
    })
    previewItem.value = preview.items[0] ?? null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    previewItem.value = null
  } finally {
    loadingPreview.value = false
  }
}

const execute = async () => {
  if (!props.skill || !selectedAgentId.value) return
  executing.value = true
  error.value = null
  try {
    const result = isDisconnect.value
      ? await skillSyncClient.removeAgentSkillLink({
          agentId: selectedAgentId.value,
          skillName: props.skill.name
        })
      : await skillSyncClient.executeLinkDeepChatSkills({
          agentId: selectedAgentId.value,
          skillNames: [props.skill.name]
        })
    if (!result.success) {
      throw new Error(
        'failed' in result
          ? result.failed[0]?.reason || t('settings.skills.installToAgent.failed')
          : result.error || t('settings.skills.installToAgent.disconnectFailed')
      )
    }
    toast({
      title: t(
        isDisconnect.value
          ? 'settings.skills.installToAgent.disconnectSuccess'
          : 'settings.skills.installToAgent.success'
      ),
      description: t(
        isDisconnect.value
          ? 'settings.skills.installToAgent.disconnectSuccessMessage'
          : 'settings.skills.installToAgent.successMessage',
        { name: props.skill.name }
      )
    })
    emit('completed')
    emit('update:open', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    toast({
      title: t(
        isDisconnect.value
          ? 'settings.skills.installToAgent.disconnectFailed'
          : 'settings.skills.installToAgent.failed'
      ),
      description: error.value,
      variant: 'destructive'
    })
  } finally {
    executing.value = false
  }
}

const statusClass = (status: LinkDeepChatSkillPreviewStatus) => {
  if (status === 'ready' || status === 'already-linked') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  if (status === 'conflict') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (status === 'missing') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  return ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      previewItem.value = null
      void loadAgents()
    }
  }
)

watch(selectedAgentId, () => {
  void loadPreview()
})
</script>
