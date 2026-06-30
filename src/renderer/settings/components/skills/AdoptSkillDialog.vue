<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent v-if="open" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon :icon="preview?.conflict ? 'lucide:git-compare-arrows' : 'lucide:copy-plus'" />
          {{
            preview?.conflict
              ? t('settings.skills.agents.adoptDialog.conflictTitle')
              : t('settings.skills.agents.adoptDialog.adoptTitle')
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            preview?.conflict
              ? t('settings.skills.agents.adoptDialog.conflictDescription', {
                  skill: preview.skillName,
                  agent: preview.agentName
                })
              : t('settings.skills.agents.adoptDialog.adoptDescription')
          }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Icon icon="lucide:loader-2" class="h-4 w-4 animate-spin" />
        {{ t('settings.skills.agents.adoptDialog.loading') }}
      </div>

      <div v-else-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
        <div class="font-medium text-destructive">
          {{ t('settings.skills.agents.adoptDialog.previewFailed') }}
        </div>
        <div class="mt-1 text-xs text-muted-foreground">{{ error }}</div>
      </div>

      <div v-else-if="preview" class="space-y-4 py-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium" :title="preview.skillName">
              {{ preview.skillName }}
            </div>
            <div class="truncate text-xs text-muted-foreground" :title="preview.agentName">
              {{ preview.agentName }}
            </div>
          </div>
          <Badge v-if="preview.conflict" variant="outline" class="shrink-0">
            {{ t('settings.skills.agents.status.conflict') }}
          </Badge>
        </div>

        <div class="min-w-0 space-y-3 rounded-md border px-3 py-3 text-sm">
          <div class="min-w-0">
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('settings.skills.agents.adoptDialog.currentLocation') }}
            </div>
            <div class="mt-1 break-all font-mono text-xs leading-5" :title="preview.sourcePath">
              {{ preview.sourcePath }}
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('settings.skills.agents.adoptDialog.afterAdoption') }}
            </div>
            <div class="mt-1 min-w-0 space-y-1">
              <div class="break-all font-mono text-xs leading-5" :title="preview.targetPath">
                {{ preview.targetPath }}
              </div>
              <div class="break-all font-mono text-xs leading-5" :title="preview.agentPath">
                {{ preview.agentPath }} {{ t('settings.skills.agents.adoptDialog.linkArrow') }}
              </div>
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-xs font-medium text-muted-foreground">
              {{ t('settings.skills.agents.adoptDialog.backup') }}
            </div>
            <div class="mt-1 break-all font-mono text-xs leading-5" :title="preview.backupRoot">
              {{ preview.backupRoot }}
            </div>
          </div>
        </div>

        <div
          v-if="preview.conflict"
          class="space-y-3 rounded-md border border-amber-500/40 px-3 py-3"
        >
          <div
            class="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300"
          >
            <Icon icon="lucide:alert-triangle" class="h-4 w-4" />
            {{ t('settings.skills.agents.adoptDialog.chooseAction') }}
          </div>
          <RadioGroup model-value="rename" class="space-y-2">
            <div class="flex items-start gap-2">
              <RadioGroupItem value="rename" id="adopt-conflict-rename" class="mt-0.5" />
              <Label for="adopt-conflict-rename" class="min-w-0 text-sm">
                {{ t('settings.skills.agents.adoptDialog.adoptAs', { name: preview.targetName }) }}
              </Label>
            </div>
            <div class="flex items-start gap-2 text-muted-foreground opacity-60">
              <RadioGroupItem disabled value="replace" id="adopt-conflict-replace" class="mt-0.5" />
              <Label for="adopt-conflict-replace" class="min-w-0 text-sm">
                {{ t('settings.skills.agents.adoptDialog.replaceDeepChat') }}
              </Label>
            </div>
            <div class="flex items-start gap-2 text-muted-foreground opacity-60">
              <RadioGroupItem disabled value="keep" id="adopt-conflict-keep" class="mt-0.5" />
              <Label for="adopt-conflict-keep" class="min-w-0 text-sm">
                {{ t('settings.skills.agents.adoptDialog.keepCurrent') }}
              </Label>
            </div>
          </RadioGroup>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.skills.agents.adoptDialog.unsupportedStrategies') }}
          </p>
        </div>

        <div v-if="preview.warnings.length" class="space-y-1 rounded-md border px-3 py-2">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t('settings.skills.agents.adoptDialog.warnings') }}
          </div>
          <div
            v-for="warning in preview.warnings"
            :key="warning"
            class="flex gap-2 text-xs text-muted-foreground"
          >
            <Icon icon="lucide:info" class="mt-0.5 h-3 w-3 shrink-0" />
            <span>{{ warning }}</span>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="ghost" :disabled="executing" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!preview || loading || executing" @click="emit('confirm')">
          <Icon
            :icon="executing ? 'lucide:loader-2' : 'lucide:copy-plus'"
            class="mr-1 h-4 w-4"
            :class="{ 'animate-spin': executing }"
          />
          {{
            preview?.conflict
              ? t('settings.skills.agents.adoptDialog.apply')
              : t('settings.skills.agents.actions.adopt')
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
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
import { Label } from '@shadcn/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import type { AdoptAgentSkillPreview } from '@shared/types/skillSync'

defineProps<{
  open: boolean
  preview: AdoptAgentSkillPreview | null
  loading: boolean
  executing: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const { t } = useI18n()
</script>
