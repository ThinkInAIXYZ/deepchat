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
          <Button :disabled="!repoUrl.trim() || scanning || installing" @click="scan">
            <Spinner v-if="scanning" data-icon="inline-start" />
            <Icon v-else icon="lucide:search" data-icon="inline-start" />
            {{ t('settings.skills.git.scan') }}
          </Button>
        </div>

        <div v-if="error" class="rounded-md border border-destructive/30 px-3 py-2 text-sm">
          <div class="font-medium text-destructive">{{ t('settings.skills.git.failed') }}</div>
          <div class="mt-1 text-xs text-muted-foreground">
            {{ t('common.error.requestFailed') }}
          </div>
        </div>

        <InlineOperationFeedback
          v-if="
            visibleInstallFeedback.status === 'success' || visibleInstallFeedback.status === 'error'
          "
          :snapshot="visibleInstallFeedback"
        />

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
                :disabled="installing || !skill.valid"
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
        <Button variant="ghost" :disabled="installing" @click="handleOpenChange(false)">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!canInstall" @click="install">
          <Spinner v-if="installing" data-icon="inline-start" />
          <Icon v-else icon="lucide:download" data-icon="inline-start" />
          {{ t('settings.skills.git.install') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
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
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
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
const installController = createRendererSurfaceFeedbackController('settings')
const { snapshot: installFeedback, setActive: setInstallFeedbackActive } =
  useSurfaceFeedback(installController)
const installOperationId = `settings.skills.gitInstall:${nanoid(8)}`

const repoUrl = ref('https://github.com/op7418/guizang-ppt-skill')
const scanResult = ref<GitSkillRepoScanResult | null>(null)
const selectedNames = ref<Set<string>>(new Set())
const strategy = ref<SkillInstallConflictStrategy>('rename')
const scanning = ref(false)
const error = ref(false)
const contextVersion = ref(0)
const feedbackContextVersion = ref<number | null>(null)
const feedbackAgentId = ref<string | undefined>()
let scanRequestId = 0
let installRequestId = 0
let installGeneration = 0

const currentAgentId = () => props.agentId?.trim() || undefined
const isCurrentContext = (agentId: string | undefined) => props.open && currentAgentId() === agentId
const installing = computed(() => installFeedback.value.status === 'pending')
const feedbackBelongsToSurface = computed(
  () =>
    feedbackContextVersion.value === contextVersion.value &&
    feedbackAgentId.value === currentAgentId()
)
const visibleInstallFeedback = computed(() => {
  const snapshot = installFeedback.value
  if (snapshot.status === 'pending' || feedbackBelongsToSurface.value) return snapshot
  return { status: 'idle' as const, version: snapshot.version }
})
const installFeedbackSurfaceActive = computed(
  () => props.open && (installFeedback.value.status === 'idle' || feedbackBelongsToSurface.value)
)

const logFailure = (message: string, cause: unknown) => {
  console.error(message, cause)
}

const dismissSettledInstallFeedback = () => {
  const snapshot = installController.getSnapshot()
  if (snapshot.status === 'success' || snapshot.status === 'error') {
    installController.clearSettled()
  }
  if (snapshot.status !== 'pending') {
    feedbackContextVersion.value = null
    feedbackAgentId.value = undefined
  }
}

const beginInstall = (agentId: string | undefined): number | null => {
  if (installController.getSnapshot().status === 'pending') return null
  const generation = ++installGeneration
  feedbackContextVersion.value = contextVersion.value
  feedbackAgentId.value = agentId
  installController.begin(installOperationId, t('settings.skills.install.installing'))
  return generation
}

const isCurrentInstall = (generation: number) =>
  generation === installGeneration && installController.getSnapshot().status === 'pending'

const handleOpenChange = (open: boolean) => {
  if (!open && installing.value) return
  if (!open) dismissSettledInstallFeedback()
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
  if (installController.getSnapshot().status !== 'idle') dismissSettledInstallFeedback()
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
  if (installController.getSnapshot().status !== 'idle') dismissSettledInstallFeedback()
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
  const generation = beginInstall(agentId)
  if (generation === null) return
  const requestId = ++installRequestId
  error.value = false
  try {
    const scannedRepoUrl = scanResult.value.repoUrl
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
      installController.fail({
        code: 'settings.skills.gitInstallIncomplete',
        title: t('settings.skills.git.failed'),
        description: t('settings.skills.git.successMessage', {
          count: installed,
          failed: failed || selectedNames.value.size
        })
      })
      return
    }
    installController.succeed({
      code: 'settings.skills.gitInstalled',
      title: t('settings.skills.git.success'),
      description: t('settings.skills.git.successMessage', { count: installed, failed })
    })
    if (surfaceCurrent) {
      installController.clearSettled()
      feedbackContextVersion.value = null
      feedbackAgentId.value = undefined
      emit('update:open', false)
    }
  } catch (cause) {
    if (!isCurrentInstall(generation) || requestId !== installRequestId) {
      return
    }
    logFailure('[InstallFromGitDialog] Failed to install repository skills', cause)
    installController.fail({
      code: 'settings.skills.gitInstallFailed',
      title: t('settings.skills.git.failed'),
      description: t('common.error.requestFailed')
    })
  }
}

watch([() => props.open, () => currentAgentId()], ([open, agentId], previous) => {
  const agentChanged = previous !== undefined && agentId !== previous[1]
  if (!open || agentChanged) {
    contextVersion.value += 1
    scanRequestId += 1
    error.value = false
    scanResult.value = null
    selectedNames.value = new Set()
    scanning.value = false
  }
})

watch(repoUrl, () => {
  if (installing.value) return
  scanRequestId += 1
  if (installController.getSnapshot().status !== 'idle') dismissSettledInstallFeedback()
  error.value = false
  scanResult.value = null
  selectedNames.value = new Set()
  scanning.value = false
})

watch(strategy, () => {
  if (installing.value || installController.getSnapshot().status === 'idle') return
  dismissSettledInstallFeedback()
})

const stopSurfaceLeaseSync = watch(
  installFeedbackSurfaceActive,
  (active) => {
    setInstallFeedbackActive(active)
  },
  { immediate: true, flush: 'sync' }
)

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
  stopSurfaceLeaseSync()
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
