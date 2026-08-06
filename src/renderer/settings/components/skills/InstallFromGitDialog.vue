<template>
  <Dialog :open="open" @update:open="handleOpenChange">
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
          <DcButton :disabled="!repoUrl.trim() || scanning || installing" @click="scan">
            <Spinner v-if="scanning" data-icon="inline-start" />
            <Icon v-else icon="lucide:search" data-icon="inline-start" />
            {{ t('settings.skills.git.scan') }}
          </DcButton>
        </div>

        <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
          <div class="font-medium text-destructive">{{ t('settings.skills.git.failed') }}</div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ t('common.error.requestFailed') }}
          </div>
        </div>

        <DcInlineError v-if="operationError" :error="operationError" class="mb-2" />

        <div v-if="scanResult" class="space-y-3">
          <div class="flex items-center justify-between gap-2 text-sm">
            <div>
              {{ t('settings.skills.git.detectedFormat') }}
              <DcBadge variant="outline">{{
                t(`settings.skills.git.format.${scanResult.repoFormat}`)
              }}</DcBadge>
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
                :disabled="installing || !skill.valid"
                @update:checked="toggleSkill(skill.name)"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium" :title="skill.name">
                    {{ skill.name }}
                  </span>
                  <DcBadge v-if="skill.conflict" variant="outline" class="shrink-0">
                    {{ t('settings.skills.git.conflict') }}
                  </DcBadge>
                  <DcBadge v-if="!skill.valid" variant="destructive" class="shrink-0">
                    {{ t('settings.skills.git.invalid') }}
                  </DcBadge>
                </span>
                <span
                  class="block truncate text-xs text-muted-foreground"
                  :title="skill.valid ? skill.description : t('settings.skills.git.invalid')"
                >
                  {{ skill.valid ? skill.description : t('settings.skills.git.invalid') }}
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
                <RadioGroupItem value="rename" :disabled="installing" />
                {{ t('settings.skills.git.rename') }}
              </label>
              <label class="flex items-center gap-2 text-sm">
                <RadioGroupItem value="overwrite" :disabled="installing" />
                {{ t('settings.skills.git.overwrite') }}
              </label>
              <label class="flex items-center gap-2 text-sm">
                <RadioGroupItem value="skip" :disabled="installing" />
                {{ t('settings.skills.git.skip') }}
              </label>
            </RadioGroup>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <DcFormActions
          :submit-status="installStatus"
          :submit-icon="'lucide:download'"
          :submit-disabled="!canInstall"
          :cancel-disabled="installing"
          :submit-label="t('settings.skills.git.install')"
          @cancel="handleOpenChange(false)"
          @submit="install"
        />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Spinner } from '@shadcn/components/ui/spinner'
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
import { DcInlineError } from '@dc-ui/components/inline-error'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { createSkillClient } from '@api/SkillClient'
import type { GitSkillRepoScanResult, SkillInstallConflictStrategy } from '@shared/types/skill'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const props = defineProps<{
  open: boolean
  agentId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const skillClient = createSkillClient()

const repoUrl = ref('https://github.com/op7418/guizang-ppt-skill')
const scanResult = ref<GitSkillRepoScanResult | null>(null)
const selectedNames = ref<Set<string>>(new Set())
const strategy = ref<SkillInstallConflictStrategy>('rename')
const scanning = ref(false)
const error = ref(false)
const operationError = ref<string | null>(null)
const contextVersion = ref(0)
let scanRequestId = 0
let installRequestId = 0
let installGeneration = 0
const installing = ref(false)
const { status: installStatus, run: runInstall } = useDcFormSubmit()

const currentAgentId = () => props.agentId?.trim() || undefined
const isCurrentContext = (agentId: string | undefined) => props.open && currentAgentId() === agentId

const logFailure = (message: string, cause: unknown) => {
  console.error(message, cause)
}

const beginInstall = (): number | null => {
  if (installing.value) return null
  const generation = ++installGeneration
  installing.value = true
  return generation
}

const isCurrentInstall = (generation: number) =>
  generation === installGeneration && installing.value

const handleOpenChange = (open: boolean) => {
  if (!open && installing.value) return
  emit('update:open', open)
}

const canInstall = computed(
  () =>
    Boolean(scanResult.value) &&
    selectedNames.value.size > 0 &&
    !scanning.value &&
    !installing.value
)

const scan = async () => {
  const requestId = ++scanRequestId
  const agentId = currentAgentId()
  const requestedRepoUrl = repoUrl.value.trim()
  error.value = false
  scanResult.value = null
  selectedNames.value = new Set()
  scanning.value = true
  try {
    const result = agentId
      ? await skillClient.scanGitSkillRepo(requestedRepoUrl, agentId)
      : await skillClient.scanGitSkillRepo(requestedRepoUrl)
    if (requestId !== scanRequestId || !isCurrentContext(agentId)) return

    scanResult.value = result
    selectedNames.value = new Set(
      result.skills.filter((skill) => skill.valid).map((skill) => skill.name)
    )
  } catch (cause) {
    if (requestId !== scanRequestId || !isCurrentContext(agentId)) return
    error.value = true
    logFailure('[InstallFromGitDialog] Failed to scan repository', cause)
    scanResult.value = null
    selectedNames.value = new Set()
  } finally {
    if (requestId === scanRequestId && isCurrentContext(agentId)) scanning.value = false
  }
}

const toggleSkill = (name: string) => {
  if (installing.value) return
  const next = new Set(selectedNames.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  selectedNames.value = next
}

const install = async () => {
  if (!scanResult.value || !canInstall.value) return
  const agentId = currentAgentId()
  const operationContextVersion = contextVersion.value
  const generation = beginInstall()
  if (generation === null) return
  const requestId = ++installRequestId
  error.value = false
  operationError.value = null
  await runInstall(async () => {
    const scannedRepoUrl = scanResult.value?.repoUrl ?? ''
    const input = {
      repoUrl: scannedRepoUrl,
      skillNames: [...selectedNames.value],
      strategy: strategy.value
    }
    const results = agentId
      ? await skillClient.installFromGit(input, agentId)
      : await skillClient.installFromGit(input)
    if (!isCurrentInstall(generation) || requestId !== installRequestId) {
      return
    }
    const surfaceCurrent =
      operationContextVersion === contextVersion.value && isCurrentContext(agentId)

    const requestedNames = new Set(input.skillNames)
    const installedSourceNames = new Set(
      results
        .filter((result) => result.success)
        .map((result) => {
          if (result.sourceSkillName && requestedNames.has(result.sourceSkillName)) {
            return result.sourceSkillName
          }
          return result.skillName && requestedNames.has(result.skillName)
            ? result.skillName
            : undefined
        })
        .filter((name): name is string => Boolean(name))
    )
    const installed = installedSourceNames.size
    const failed = input.skillNames.length - installed
    if (failed > 0) {
      if (surfaceCurrent) {
        selectedNames.value = new Set(
          input.skillNames.filter((skillName) => !installedSourceNames.has(skillName))
        )
      }
      installing.value = false
      operationError.value = t('settings.skills.git.successMessage', {
        count: installed,
        failed: failed || selectedNames.value.size
      })
      throw new Error('Git repository install was incomplete')
    }
    installing.value = false
    if (surfaceCurrent) {
      emit('update:open', false)
    }
  }).catch((cause) => {
    if (!isCurrentInstall(generation) || requestId !== installRequestId) {
      return
    }
    if (!operationError.value) {
      logFailure('[InstallFromGitDialog] Failed to install repository skills', cause)
      operationError.value = t('common.error.requestFailed')
      installing.value = false
    }
  })
}

watch([() => props.open, () => currentAgentId()], ([open, agentId], previous) => {
  const agentChanged = previous !== undefined && agentId !== previous[1]
  if (!open || agentChanged) {
    contextVersion.value += 1
    scanRequestId += 1
    error.value = false
    operationError.value = null
    scanResult.value = null
    selectedNames.value = new Set()
    scanning.value = false
  }
})

watch(repoUrl, () => {
  if (installing.value) return
  scanRequestId += 1
  error.value = false
  operationError.value = null
  scanResult.value = null
  selectedNames.value = new Set()
  scanning.value = false
})

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.gitInstall:${nanoid(8)}`,
  onDiscard: () => undefined
})
const stopLeaveRiskSync = watch(
  installing,
  (pending) => {
    leaveGuardLease.setRisk(pending ? 'busy' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
