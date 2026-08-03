<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('settings.skills.install.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.skills.install.description') }}
        </DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full grid-cols-3">
          <TabsTrigger value="folder" :disabled="installing">
            <Icon icon="lucide:folder" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabFolder') }}
          </TabsTrigger>
          <TabsTrigger value="zip" :disabled="installing">
            <Icon icon="lucide:file-archive" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabZip') }}
          </TabsTrigger>
          <TabsTrigger value="url" :disabled="installing">
            <Icon icon="lucide:link" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabUrl') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="folder" class="mt-4">
          <div
            class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
            :class="
              installing
                ? 'cursor-not-allowed opacity-60'
                : dragActive === 'folder'
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/50 cursor-pointer'
            "
            @click="selectFolder"
            @dragenter.prevent="onDragEnter('folder')"
            @dragover.prevent
            @dragleave.prevent="onDragLeave"
            @drop.prevent="handleDrop($event)"
          >
            <Icon
              v-if="!installing"
              icon="lucide:folder-open"
              class="pointer-events-none mx-auto mb-2 size-10 text-muted-foreground"
            />
            <Spinner
              v-else
              class="pointer-events-none mx-auto mb-2 size-10 text-muted-foreground"
            />
            <p class="text-sm text-muted-foreground pointer-events-none">
              {{ t('settings.skills.install.folderHint') }}
            </p>
          </div>
          <p class="text-xs text-muted-foreground/70 mt-2">
            {{ t('settings.skills.install.folderTip') }}
          </p>
        </TabsContent>

        <TabsContent value="zip" class="mt-4">
          <div
            class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
            :class="
              installing
                ? 'cursor-not-allowed opacity-60'
                : dragActive === 'zip'
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/50 cursor-pointer'
            "
            @click="selectZip"
            @dragenter.prevent="onDragEnter('zip')"
            @dragover.prevent
            @dragleave.prevent="onDragLeave"
            @drop.prevent="handleDrop($event)"
          >
            <Icon
              v-if="!installing"
              icon="lucide:file-archive"
              class="pointer-events-none mx-auto mb-2 size-10 text-muted-foreground"
            />
            <Spinner
              v-else
              class="pointer-events-none mx-auto mb-2 size-10 text-muted-foreground"
            />
            <p class="text-sm text-muted-foreground pointer-events-none">
              {{ t('settings.skills.install.zipHint') }}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="url" class="mt-4 space-y-4">
          <div class="space-y-2">
            <Input
              v-model="installUrl"
              :placeholder="t('settings.skills.install.urlPlaceholder')"
              :disabled="installing"
            />
            <p class="text-xs text-muted-foreground/70">
              {{ t('settings.skills.install.urlHint') }}
            </p>
          </div>
          <Button
            class="w-full"
            :disabled="!installUrl.trim() || installing"
            @click="installFromUrl"
          >
            <Spinner v-if="installing" data-icon="inline-start" />
            {{ t('settings.skills.install.installButton') }}
          </Button>
        </TabsContent>
      </Tabs>

      <div
        v-if="validationError"
        class="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
      >
        {{ validationError }}
      </div>
      <InlineOperationFeedback
        v-if="
          visibleInstallFeedback.status === 'success' || visibleInstallFeedback.status === 'error'
        "
        :snapshot="visibleInstallFeedback"
      />
    </DialogContent>
  </Dialog>

  <!-- Conflict confirmation dialog -->
  <AlertDialog :open="conflictDialogOpen" @update:open="handleConflictOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('settings.skills.conflict.title') }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t('settings.skills.conflict.description', { name: conflictSkillName }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleConflictCancel">
          {{ t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction data-testid="skill-conflict-overwrite" @click="handleConflictOverwrite">
          {{ t('settings.skills.conflict.overwrite') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { useSkillsStore } from '@/stores/skillsStore'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import { createRendererSurfaceFeedbackController } from '@renderer-notifications/rendererNotificationRuntime'
import { useSurfaceFeedback } from '@renderer-notifications/useSurfaceFeedback'
import { createSkillClient } from '@api/SkillClient'
import { createDeviceClient } from '@api/DeviceClient'
import { createFileClient } from '@api/FileClient'
import type { SkillInstallResult } from '@shared/types/skill'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const props = defineProps<{
  open: boolean
  agentId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const skillsStore = useSkillsStore()
const skillClient = createSkillClient()
const deviceClient = createDeviceClient()
const fileClient = createFileClient()
const installController = createRendererSurfaceFeedbackController('settings')
const { snapshot: installFeedback, setActive: setInstallFeedbackActive } =
  useSurfaceFeedback(installController)
const installOperationId = `settings.skills.install:${nanoid(8)}`

const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    if (!value && installing.value) return
    if (!value) dismissSettledInstallFeedback()
    emit('update:open', value)
  }
})

const activeTab = ref('folder')
const installUrl = ref('')
const validationError = ref('')

// Drag and drop state: which zone is currently being dragged over
const dragActive = ref<'folder' | 'zip' | null>(null)

type ConflictRequest =
  | { status: 'idle' }
  | { status: 'confirming'; skillName: string; overwrite: () => Promise<void> }
  | { status: 'pending'; skillName: string; overwrite: () => Promise<void> }

// Preserve request identity so a settled overwrite cannot clear a newer conflict.
const conflictRequest = shallowRef<ConflictRequest>({ status: 'idle' })
const conflictDialogOpen = computed(() => conflictRequest.value.status === 'confirming')
const conflictSkillName = computed(() =>
  conflictRequest.value.status === 'idle' ? '' : conflictRequest.value.skillName
)
const contextVersion = ref(0)
const feedbackContextVersion = ref<number | null>(null)
const feedbackAgentId = ref<string | undefined>()
let pickerRequestId = 0
let installRequestId = 0
let installGeneration = 0

const currentAgentId = () => props.agentId?.trim() || undefined
const isCurrentContext = (version: number, agentId: string | undefined) =>
  props.open && version === contextVersion.value && currentAgentId() === agentId
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

const logFailure = (message: string, error: unknown) => {
  console.error(message, error)
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

const showValidationError = (message: string) => {
  const snapshot = installController.getSnapshot()
  if (snapshot.status === 'success' || snapshot.status === 'error') {
    dismissSettledInstallFeedback()
  }
  validationError.value = message
}

// Invalidate non-cancellable picker and IPC results when the destination changes or closes.
watch([() => props.open, () => currentAgentId()], ([open, agentId], previous) => {
  const agentChanged = previous !== undefined && agentId !== previous[1]
  if (!open || agentChanged) {
    contextVersion.value += 1
    pickerRequestId += 1
    conflictRequest.value = { status: 'idle' }
    dragActive.value = null
    validationError.value = ''
  }
})

// Folder installation
const executeInstall = async (
  agentId: string | undefined,
  request: () => Promise<SkillInstallResult>,
  retryWithOverwrite: () => Promise<void>
) => {
  const version = contextVersion.value
  if (!isCurrentContext(version, agentId)) return
  const generation = beginInstall(agentId)
  if (generation === null) return
  const requestId = ++installRequestId
  validationError.value = ''
  try {
    const result = await request()
    if (!isCurrentInstall(generation) || requestId !== installRequestId) {
      return
    }
    handleInstallResult(result, retryWithOverwrite, isCurrentContext(version, agentId))
  } catch (error) {
    if (!isCurrentInstall(generation) || requestId !== installRequestId) {
      return
    }
    showError(error)
  }
}

const selectFolder = async () => {
  if (installing.value) return
  const requestId = ++pickerRequestId
  const version = contextVersion.value
  const agentId = currentAgentId()
  try {
    const result = await deviceClient.selectDirectory()
    if (requestId !== pickerRequestId || !isCurrentContext(version, agentId)) return
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromFolder(result.filePaths[0], false, agentId)
    }
  } catch (error) {
    if (requestId === pickerRequestId && isCurrentContext(version, agentId)) {
      logFailure('[SkillInstallDialog] Failed to select a folder', error)
      validationError.value = t('common.error.requestFailed')
    }
  }
}

const tryInstallFromFolder = async (
  folderPath: string,
  overwrite = false,
  agentId: string | undefined = currentAgentId()
) => {
  await executeInstall(
    agentId,
    () =>
      agentId
        ? skillClient.installFromFolder(folderPath, { overwrite }, agentId)
        : skillsStore.installFromFolder(folderPath, { overwrite }),
    () => tryInstallFromFolder(folderPath, true, agentId)
  )
}

// ZIP installation
const selectZip = async () => {
  if (installing.value) return
  const requestId = ++pickerRequestId
  const version = contextVersion.value
  const agentId = currentAgentId()
  try {
    const result = await deviceClient.selectFiles({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    if (requestId !== pickerRequestId || !isCurrentContext(version, agentId)) return
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromZip(result.filePaths[0], false, agentId)
    }
  } catch (error) {
    if (requestId === pickerRequestId && isCurrentContext(version, agentId)) {
      logFailure('[SkillInstallDialog] Failed to select a ZIP archive', error)
      validationError.value = t('common.error.requestFailed')
    }
  }
}

const tryInstallFromZip = async (
  zipPath: string,
  overwrite = false,
  agentId: string | undefined = currentAgentId()
) => {
  await executeInstall(
    agentId,
    () =>
      agentId
        ? skillClient.installFromZip(zipPath, { overwrite }, agentId)
        : skillsStore.installFromZip(zipPath, { overwrite }),
    () => tryInstallFromZip(zipPath, true, agentId)
  )
}

// Drag and drop handlers
const onDragEnter = (zone: 'folder' | 'zip') => {
  if (installing.value) return
  dragActive.value = zone
}

const onDragLeave = () => {
  dragActive.value = null
}

const handleDrop = async (event: DragEvent) => {
  dragActive.value = null
  if (installing.value) return

  const items = event.dataTransfer?.items
  const files = event.dataTransfer?.files
  if (!items || items.length === 0) return

  if (items.length > 1 || (files && files.length > 1)) {
    showDropError()
    return
  }

  const item = items[0]
  const entry = item.webkitGetAsEntry?.()
  const file = item.getAsFile?.()
  if (!file) {
    showDropError()
    return
  }

  const path = fileClient.getPathForFile(file)
  if (!path) {
    showDropError()
    return
  }

  // Route by dropped content type, independent of the active tab
  if (entry?.isDirectory) {
    await tryInstallFromFolder(path)
  } else if (file.name.toLowerCase().endsWith('.zip')) {
    await tryInstallFromZip(path)
  } else {
    showDropError()
  }
}

const showDropError = () => {
  showValidationError(t('settings.skills.install.dragInvalid'))
}

// URL validation helper
const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

// URL installation
const installFromUrl = async () => {
  if (!installUrl.value || installing.value) return
  const url = installUrl.value.trim()
  if (!isValidUrl(url)) {
    showValidationError(t('settings.skills.install.urlHint'))
    return
  }
  await tryInstallFromUrl(url, false, currentAgentId())
}

const tryInstallFromUrl = async (
  url: string,
  overwrite = false,
  agentId: string | undefined = currentAgentId()
) => {
  await executeInstall(
    agentId,
    () =>
      agentId
        ? skillClient.installFromUrl(url, { overwrite }, agentId)
        : skillsStore.installFromUrl(url, { overwrite }),
    () => tryInstallFromUrl(url, true, agentId)
  )
}

// Common result handling
const handleInstallResult = (
  result: SkillInstallResult,
  retryWithOverwrite: () => Promise<void>,
  surfaceCurrent: boolean
) => {
  if (result.success) {
    installController.succeed({
      code: 'settings.skills.installed',
      title: t('settings.skills.install.success'),
      description: t('settings.skills.install.successMessage', { name: result.skillName })
    })
    if (surfaceCurrent) {
      installController.clearSettled()
      feedbackContextVersion.value = null
      feedbackAgentId.value = undefined
      installUrl.value = ''
      isOpen.value = false
    }
  } else if (result.errorCode === 'conflict') {
    if (!surfaceCurrent) {
      installController.fail({
        code: 'settings.skills.installConflict',
        title: t('settings.skills.conflict.title'),
        description: t('settings.skills.conflict.description', {
          name: result.existingSkillName || result.skillName || ''
        })
      })
      return
    }
    installController.cancelPending()
    conflictRequest.value = {
      status: 'confirming',
      skillName: result.existingSkillName || result.skillName || '',
      overwrite: retryWithOverwrite
    }
  } else {
    console.error('[SkillInstallDialog] Skill installation was rejected', {
      errorCode: result.errorCode ?? 'UnknownError'
    })
    installController.fail({
      code: 'settings.skills.installFailed',
      title: t('settings.skills.install.failed'),
      description: t('common.error.requestFailed')
    })
  }
}

const handleConflictCancel = () => {
  if (conflictRequest.value.status === 'confirming') {
    conflictRequest.value = { status: 'idle' }
  }
}

const handleConflictOpenChange = (open: boolean) => {
  if (!open) handleConflictCancel()
}

const runConflictOverwrite = async (
  request: Extract<ConflictRequest, { status: 'confirming' }>,
  pendingRequest: Extract<ConflictRequest, { status: 'pending' }>
): Promise<void> => {
  try {
    await request.overwrite()
  } catch (error) {
    showError(error)
  } finally {
    if (conflictRequest.value === pendingRequest) {
      conflictRequest.value = { status: 'idle' }
    }
  }
}

const handleConflictOverwrite = () => {
  const request = conflictRequest.value
  if (request.status !== 'confirming') return
  const pendingRequest = { ...request, status: 'pending' as const }
  conflictRequest.value = pendingRequest
  void runConflictOverwrite(request, pendingRequest)
}

const showError = (error: unknown) => {
  logFailure('[SkillInstallDialog] Skill installation failed', error)
  if (installController.getSnapshot().status !== 'pending') {
    validationError.value = t('common.error.requestFailed')
    return
  }
  installController.fail({
    code: 'settings.skills.installFailed',
    title: t('settings.skills.install.failed'),
    description: t('common.error.requestFailed')
  })
}

watch([activeTab, installUrl], () => {
  if (installing.value) return
  validationError.value = ''
  const snapshot = installController.getSnapshot()
  if (snapshot.status === 'success' || snapshot.status === 'error') {
    dismissSettledInstallFeedback()
  }
})

const stopSurfaceLeaseSync = watch(
  installFeedbackSurfaceActive,
  (active) => {
    setInstallFeedbackActive(active)
  },
  { immediate: true, flush: 'sync' }
)

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.install:${nanoid(8)}`,
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
