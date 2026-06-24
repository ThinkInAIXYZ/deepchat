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
          <TabsTrigger value="folder">
            <Icon icon="lucide:folder" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabFolder') }}
          </TabsTrigger>
          <TabsTrigger value="zip">
            <Icon icon="lucide:file-archive" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabZip') }}
          </TabsTrigger>
          <TabsTrigger value="url">
            <Icon icon="lucide:link" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.install.tabUrl') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="folder" class="mt-4">
          <div
            class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
            :class="
              dragActive === 'folder'
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
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 pointer-events-none"
            />
            <Icon
              v-else
              icon="lucide:loader-2"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 animate-spin pointer-events-none"
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
              dragActive === 'zip'
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
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 pointer-events-none"
            />
            <Icon
              v-else
              icon="lucide:loader-2"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 animate-spin pointer-events-none"
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
          <Button class="w-full" :disabled="!installUrl || installing" @click="installFromUrl">
            <Icon v-if="installing" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('settings.skills.install.installButton') }}
          </Button>
        </TabsContent>
      </Tabs>

      <!-- Progress indicator -->
      <div v-if="installing" class="mt-4">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
          <span>{{ t('settings.skills.install.installing') }}</span>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <!-- Conflict confirmation dialog -->
  <AlertDialog v-model:open="conflictDialogOpen">
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
        <AlertDialogAction @click="handleConflictOverwrite">
          {{ t('settings.skills.conflict.overwrite') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
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
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { createDeviceClient } from '@api/DeviceClient'
import { createFileClient } from '@api/FileClient'
import type { SkillInstallResult } from '@shared/types/skill'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  installed: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const deviceClient = createDeviceClient()
const fileClient = createFileClient()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const activeTab = ref('folder')
const installUrl = ref('')
const installing = ref(false)

// Drag and drop state: which zone is currently being dragged over
const dragActive = ref<'folder' | 'zip' | null>(null)

// Conflict handling
const conflictDialogOpen = ref(false)
const conflictSkillName = ref('')
const pendingInstallAction = ref<(() => Promise<void>) | null>(null)

// Clear pending action when dialog closes to prevent memory leaks
watch(isOpen, (open) => {
  if (!open) {
    pendingInstallAction.value = null
    conflictDialogOpen.value = false
    conflictSkillName.value = ''
    dragActive.value = null
  }
})

// Folder installation
const selectFolder = async () => {
  if (installing.value) return
  try {
    const result = await deviceClient.selectDirectory()
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromFolder(result.filePaths[0])
    }
  } catch (error) {
    showError(error)
  }
}

const tryInstallFromFolder = async (folderPath: string, overwrite = false) => {
  installing.value = true
  try {
    const result = await skillsStore.installFromFolder(folderPath, { overwrite })
    handleInstallResult(result, () => tryInstallFromFolder(folderPath, true))
  } finally {
    installing.value = false
  }
}

// ZIP installation
const selectZip = async () => {
  if (installing.value) return
  try {
    const result = await deviceClient.selectFiles({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromZip(result.filePaths[0])
    }
  } catch (error) {
    showError(error)
  }
}

const tryInstallFromZip = async (zipPath: string, overwrite = false) => {
  installing.value = true
  try {
    const result = await skillsStore.installFromZip(zipPath, { overwrite })
    handleInstallResult(result, () => tryInstallFromZip(zipPath, true))
  } finally {
    installing.value = false
  }
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
  toast({
    title: t('settings.skills.install.failed'),
    description: t('settings.skills.install.dragInvalid'),
    variant: 'destructive'
  })
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
  if (!isValidUrl(installUrl.value)) {
    toast({
      title: t('settings.skills.install.failed'),
      description: 'Invalid URL format. Please enter a valid HTTP or HTTPS URL.',
      variant: 'destructive'
    })
    return
  }
  await tryInstallFromUrl(installUrl.value)
}

const tryInstallFromUrl = async (url: string, overwrite = false) => {
  installing.value = true
  try {
    const result = await skillsStore.installFromUrl(url, { overwrite })
    handleInstallResult(result, () => tryInstallFromUrl(url, true))
    if (result.success) {
      installUrl.value = ''
    }
  } finally {
    installing.value = false
  }
}

// Common result handling
const handleInstallResult = (
  result: SkillInstallResult,
  retryWithOverwrite: () => Promise<void>
) => {
  if (result.success) {
    toast({
      title: t('settings.skills.install.success'),
      description: t('settings.skills.install.successMessage', { name: result.skillName })
    })
    emit('installed')
    isOpen.value = false
  } else if (result.errorCode === 'conflict') {
    const skillName = result.existingSkillName || result.error?.match(/"([^"]+)"/)?.[1] || ''
    conflictSkillName.value = skillName
    pendingInstallAction.value = retryWithOverwrite
    conflictDialogOpen.value = true
  } else {
    toast({
      title: t('settings.skills.install.failed'),
      description: result.error,
      variant: 'destructive'
    })
  }
}

const handleConflictCancel = () => {
  conflictDialogOpen.value = false
  pendingInstallAction.value = null
  conflictSkillName.value = ''
}

const handleConflictOverwrite = async () => {
  conflictDialogOpen.value = false
  if (pendingInstallAction.value) {
    await pendingInstallAction.value()
    pendingInstallAction.value = null
  }
  conflictSkillName.value = ''
}

const showError = (error: unknown) => {
  console.error('Install error:', error)
  toast({
    title: t('settings.skills.install.failed'),
    description: String(error),
    variant: 'destructive'
  })
}
</script>
