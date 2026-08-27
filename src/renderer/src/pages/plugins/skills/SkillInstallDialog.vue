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
            class="rounded-lg border-2 border-dashed p-8 text-center transition-colors"
            :class="
              installing
                ? 'cursor-not-allowed opacity-60'
                : dragActive === 'folder'
                  ? 'border-primary bg-primary/5'
                  : 'cursor-pointer hover:border-primary/50'
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
            <p class="pointer-events-none text-sm text-muted-foreground">
              {{ t('settings.skills.install.folderHint') }}
            </p>
          </div>
          <p class="mt-2 text-xs text-muted-foreground/70">
            {{ t('settings.skills.install.folderTip') }}
          </p>
        </TabsContent>

        <TabsContent value="zip" class="mt-4">
          <div
            class="rounded-lg border-2 border-dashed p-8 text-center transition-colors"
            :class="
              installing
                ? 'cursor-not-allowed opacity-60'
                : dragActive === 'zip'
                  ? 'border-primary bg-primary/5'
                  : 'cursor-pointer hover:border-primary/50'
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
            <p class="pointer-events-none text-sm text-muted-foreground">
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
          <DcSubmitButton
            class="w-full"
            :status="installStatus"
            :disabled="!installUrl.trim() || installing"
            @click="installFromUrl"
          >
            {{ t('settings.skills.install.installButton') }}
          </DcSubmitButton>
        </TabsContent>
      </Tabs>

      <div
        v-if="validationError"
        class="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive"
      >
        {{ validationError }}
      </div>
      <DcInlineError v-if="operationError" :error="operationError" class="mt-2" />
    </DialogContent>
  </Dialog>

  <!-- Conflict confirmation dialog -->
  <DcConfirmDialog
    :open="conflictDialogOpen"
    :title="t('settings.skills.conflict.title')"
    :description="t('settings.skills.conflict.description', { name: conflictSkillName })"
    :danger="false"
    :confirm-label="t('settings.skills.conflict.overwrite')"
    :cancel-label="t('common.cancel')"
    :confirm-attrs="{ 'data-testid': 'skill-conflict-overwrite' }"
    @update:open="handleConflictOpenChange"
    @confirm="handleConflictOverwrite"
    @cancel="handleConflictCancel"
  />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Input } from '@shadcn/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { createSkillClient } from '@api/SkillClient'
import { createDeviceClient } from '@api/DeviceClient'
import { createFileClient } from '@api/FileClient'
import type { SkillInstallResult } from '@shared/types/skill'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const skillClient = createSkillClient()
const deviceClient = createDeviceClient()
const fileClient = createFileClient()

const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    if (!value && installing.value) return
    emit('update:open', value)
  }
})

const activeTab = ref('folder')
const installUrl = ref('')
const validationError = ref('')
const operationError = ref<string | null>(null)
const { status: installStatus, run: runInstall } = useDcFormSubmit()

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
let pickerRequestId = 0
let installRequestId = 0
let installGeneration = 0
const installing = ref(false)

const isCurrentContext = (version: number) => props.open && version === contextVersion.value

const logFailure = (message: string, error: unknown) => {
  console.error(message, error)
}

const beginInstall = (): number | null => {
  if (installing.value) return null
  const generation = ++installGeneration
  installing.value = true
  return generation
}

const isCurrentInstall = (generation: number) =>
  generation === installGeneration && installing.value

const showValidationError = (message: string) => {
  validationError.value = message
}

// Invalidate non-cancellable picker and IPC results when the dialog closes.
watch(
  () => props.open,
  (open) => {
    if (!open) {
      contextVersion.value += 1
      pickerRequestId += 1
      conflictRequest.value = { status: 'idle' }
      dragActive.value = null
      validationError.value = ''
      operationError.value = null
    }
  }
)

// Folder / ZIP / URL installation
const executeInstall = async (
  request: () => Promise<SkillInstallResult>,
  retryWithOverwrite: () => Promise<void>
) => {
  const version = contextVersion.value
  if (!isCurrentContext(version)) return
  const generation = beginInstall()
  if (generation === null) return
  const requestId = ++installRequestId
  validationError.value = ''
  operationError.value = null
  await runInstall(async () => {
    try {
      const result = await request()
      if (!isCurrentInstall(generation) || requestId !== installRequestId) return
      handleInstallResult(result, retryWithOverwrite, isCurrentContext(version))
    } catch (error) {
      if (!isCurrentInstall(generation) || requestId !== installRequestId) return
      showError(error)
      throw error
    }
  }).catch(() => {
    // runInstall already settled the status to error; the inline error is
    // set by showError/handleInstallResult, keep a fallback for edge cases.
    if (!operationError.value) {
      operationError.value = t('common.error.requestFailed')
      installing.value = false
    }
  })
}

const selectFolder = async () => {
  if (installing.value) return
  const requestId = ++pickerRequestId
  const version = contextVersion.value
  try {
    const result = await deviceClient.selectDirectory()
    if (requestId !== pickerRequestId || !isCurrentContext(version)) return
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromFolder(result.filePaths[0], false)
    }
  } catch (error) {
    if (requestId === pickerRequestId && isCurrentContext(version)) {
      logFailure('[SkillInstallDialog] Failed to select a folder', error)
      validationError.value = t('common.error.requestFailed')
    }
  }
}

const tryInstallFromFolder = async (folderPath: string, overwrite = false) => {
  await executeInstall(
    () => skillClient.installFromFolder(folderPath, { overwrite }),
    () => tryInstallFromFolder(folderPath, true)
  )
}

const selectZip = async () => {
  if (installing.value) return
  const requestId = ++pickerRequestId
  const version = contextVersion.value
  try {
    const result = await deviceClient.selectFiles({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    if (requestId !== pickerRequestId || !isCurrentContext(version)) return
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromZip(result.filePaths[0], false)
    }
  } catch (error) {
    if (requestId === pickerRequestId && isCurrentContext(version)) {
      logFailure('[SkillInstallDialog] Failed to select a ZIP archive', error)
      validationError.value = t('common.error.requestFailed')
    }
  }
}

const tryInstallFromZip = async (zipPath: string, overwrite = false) => {
  await executeInstall(
    () => skillClient.installFromZip(zipPath, { overwrite }),
    () => tryInstallFromZip(zipPath, true)
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

const installFromUrl = async () => {
  if (!installUrl.value || installing.value) return
  const url = installUrl.value.trim()
  if (!isValidUrl(url)) {
    showValidationError(t('settings.skills.install.urlHint'))
    return
  }
  await tryInstallFromUrl(url, false)
}

const tryInstallFromUrl = async (url: string, overwrite = false) => {
  await executeInstall(
    () => skillClient.installFromUrl(url, { overwrite }),
    () => tryInstallFromUrl(url, true)
  )
}

// Common result handling
const handleInstallResult = (
  result: SkillInstallResult,
  retryWithOverwrite: () => Promise<void>,
  surfaceCurrent: boolean
) => {
  if (result.success) {
    installing.value = false
    if (surfaceCurrent) {
      installUrl.value = ''
      isOpen.value = false
    }
  } else if (result.errorCode === 'conflict') {
    if (!surfaceCurrent) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.skills.installConflict',
        title: t('settings.skills.conflict.title'),
        description: t('settings.skills.conflict.description', {
          name: result.existingSkillName || result.skillName || ''
        })
      })
      installing.value = false
      return
    }
    installing.value = false
    conflictRequest.value = {
      status: 'confirming',
      skillName: result.existingSkillName || result.skillName || '',
      overwrite: retryWithOverwrite
    }
  } else {
    console.error('[SkillInstallDialog] Skill installation was rejected', {
      errorCode: result.errorCode ?? 'UnknownError'
    })
    operationError.value = t('common.error.requestFailed')
    installing.value = false
    throw new Error('Skill installation was rejected')
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
  operationError.value = t('common.error.requestFailed')
  installing.value = false
}

watch([activeTab, installUrl], () => {
  if (installing.value) return
  validationError.value = ''
  operationError.value = null
})
</script>
