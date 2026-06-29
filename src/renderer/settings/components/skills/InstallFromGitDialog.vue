<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent v-if="open" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('settings.skills.git.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.skills.git.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="flex gap-2">
          <Input
            v-model="repoUrl"
            :placeholder="t('settings.skills.git.placeholder')"
            :disabled="scanning || installing"
          />
          <Button :disabled="!repoUrl || scanning || installing" @click="scan">
            <Icon
              :icon="scanning ? 'lucide:loader-2' : 'lucide:search'"
              class="mr-1 h-4 w-4"
              :class="{ 'animate-spin': scanning }"
            />
            {{ t('settings.skills.git.scan') }}
          </Button>
        </div>

        <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
          <div class="font-medium text-destructive">{{ t('settings.skills.git.failed') }}</div>
          <div class="mt-1 text-xs text-muted-foreground">{{ error }}</div>
        </div>

        <div v-if="scanResult" class="space-y-3">
          <div class="flex items-center justify-between gap-2 text-sm">
            <div>
              {{ t('settings.skills.git.detectedFormat') }}
              <Badge variant="outline">{{
                t(`settings.skills.git.format.${scanResult.repoFormat}`)
              }}</Badge>
            </div>
            <div class="text-xs text-muted-foreground">
              {{ t('settings.skills.git.selectedCount', { count: selectedNames.size }) }}
            </div>
          </div>

          <div class="max-h-72 overflow-auto rounded-md border">
            <div
              v-if="scanResult.skills.length === 0"
              class="px-3 py-8 text-center text-sm text-muted-foreground"
            >
              {{ t('settings.skills.git.empty') }}
            </div>
            <label
              v-for="skill in scanResult.skills"
              :key="skill.relativePath"
              class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
              :class="{ 'cursor-not-allowed opacity-60': !skill.valid }"
            >
              <Checkbox
                :checked="selectedNames.has(skill.name)"
                :disabled="!skill.valid"
                @update:checked="toggleSkill(skill.name)"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium" :title="skill.name">
                    {{ skill.name }}
                  </span>
                  <Badge v-if="skill.conflict" variant="outline" class="shrink-0">
                    {{ t('settings.skills.git.conflict') }}
                  </Badge>
                  <Badge v-if="!skill.valid" variant="destructive" class="shrink-0">
                    {{ t('settings.skills.git.invalid') }}
                  </Badge>
                </span>
                <span
                  class="block truncate text-xs text-muted-foreground"
                  :title="skill.error || skill.description"
                >
                  {{ skill.error || skill.description }}
                </span>
                <span
                  class="block truncate font-mono text-xs text-muted-foreground"
                  :title="skill.relativePath"
                >
                  {{ skill.relativePath }}
                </span>
              </span>
            </label>
          </div>

          <div class="space-y-2 rounded-md border px-3 py-3">
            <div class="text-sm font-medium">{{ t('settings.skills.git.strategy') }}</div>
            <RadioGroup v-model="strategy" class="grid gap-2 sm:grid-cols-3">
              <label class="flex items-center gap-2 text-sm">
                <RadioGroupItem value="rename" />
                {{ t('settings.skills.git.rename') }}
              </label>
              <label class="flex items-center gap-2 text-sm">
                <RadioGroupItem value="overwrite" />
                {{ t('settings.skills.git.overwrite') }}
              </label>
              <label class="flex items-center gap-2 text-sm">
                <RadioGroupItem value="skip" />
                {{ t('settings.skills.git.skip') }}
              </label>
            </RadioGroup>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="ghost" :disabled="installing" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!canInstall" @click="install">
          <Icon
            :icon="installing ? 'lucide:loader-2' : 'lucide:download'"
            class="mr-1 h-4 w-4"
            :class="{ 'animate-spin': installing }"
          />
          {{ t('settings.skills.git.install') }}
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
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { useToast } from '@/components/use-toast'
import { createSkillClient } from '@api/SkillClient'
import type { GitSkillRepoScanResult, SkillInstallConflictStrategy } from '@shared/types/skill'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  installed: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillClient = createSkillClient()

const repoUrl = ref('https://github.com/op7418/guizang-ppt-skill')
const scanResult = ref<GitSkillRepoScanResult | null>(null)
const selectedNames = ref<Set<string>>(new Set())
const strategy = ref<SkillInstallConflictStrategy>('rename')
const scanning = ref(false)
const installing = ref(false)
const error = ref<string | null>(null)

const canInstall = computed(
  () =>
    Boolean(scanResult.value) &&
    selectedNames.value.size > 0 &&
    !scanning.value &&
    !installing.value
)

const scan = async () => {
  error.value = null
  scanning.value = true
  try {
    scanResult.value = await skillClient.scanGitSkillRepo(repoUrl.value)
    selectedNames.value = new Set(
      scanResult.value.skills.filter((skill) => skill.valid).map((skill) => skill.name)
    )
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    scanResult.value = null
    selectedNames.value = new Set()
  } finally {
    scanning.value = false
  }
}

const toggleSkill = (name: string) => {
  const next = new Set(selectedNames.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  selectedNames.value = next
}

const install = async () => {
  if (!scanResult.value) return
  error.value = null
  installing.value = true
  try {
    const results = await skillClient.installFromGit({
      repoUrl: repoUrl.value,
      skillNames: [...selectedNames.value],
      strategy: strategy.value
    })
    const installed = results.filter((result) => result.success).length
    const failed = results.length - installed
    if (failed > 0 && installed === 0) {
      throw new Error(
        results.find((result) => !result.success)?.error || t('settings.skills.git.failed')
      )
    }
    toast({
      title: t('settings.skills.git.success'),
      description: t('settings.skills.git.successMessage', { count: installed, failed })
    })
    emit('installed')
    emit('update:open', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    toast({
      title: t('settings.skills.git.failed'),
      description: error.value,
      variant: 'destructive'
    })
  } finally {
    installing.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      error.value = null
      scanning.value = false
      installing.value = false
    }
  }
)
</script>
