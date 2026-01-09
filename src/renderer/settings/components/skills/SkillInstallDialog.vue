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
            class="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            :class="{ 'border-primary bg-primary/5': folderDragOver }"
            @click="selectFolder"
            @dragover.prevent="folderDragOver = true"
            @dragleave="folderDragOver = false"
            @drop.prevent="handleFolderDrop"
          >
            <Icon
              v-if="!installing"
              icon="lucide:folder-open"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2"
            />
            <Icon
              v-else
              icon="lucide:loader-2"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 animate-spin"
            />
            <p class="text-sm text-muted-foreground">
              {{ t('settings.skills.install.folderHint') }}
            </p>
          </div>
          <p class="text-xs text-muted-foreground/70 mt-2">
            {{ t('settings.skills.install.folderTip') }}
          </p>
        </TabsContent>

        <TabsContent value="zip" class="mt-4">
          <div
            class="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            :class="{ 'border-primary bg-primary/5': zipDragOver }"
            @click="selectZip"
            @dragover.prevent="zipDragOver = true"
            @dragleave="zipDragOver = false"
            @drop.prevent="handleZipDrop"
          >
            <Icon
              v-if="!installing"
              icon="lucide:file-archive"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2"
            />
            <Icon
              v-else
              icon="lucide:loader-2"
              class="w-10 h-10 mx-auto text-muted-foreground mb-2 animate-spin"
            />
            <p class="text-sm text-muted-foreground">
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
import { ref, computed } from 'vue'
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
import { usePresenter } from '@/composables/usePresenter'

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
const devicePresenter = usePresenter('devicePresenter')

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const activeTab = ref('folder')
const installUrl = ref('')
const installing = ref(false)
const folderDragOver = ref(false)
const zipDragOver = ref(false)

// Conflict handling
const conflictDialogOpen = ref(false)
const conflictSkillName = ref('')
const pendingInstallAction = ref<(() => Promise<void>) | null>(null)

// Folder installation
const selectFolder = async () => {
  if (installing.value) return
  try {
    const result = await devicePresenter.selectDirectory()
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromFolder(result.filePaths[0])
    }
  } catch (error) {
    showError(error)
  }
}

const handleFolderDrop = async (event: DragEvent) => {
  folderDragOver.value = false
  const items = event.dataTransfer?.items
  if (items && items.length > 0) {
    // Note: Web drag-drop doesn't give full path access in Electron renderer
    // This would need special handling via IPC
    toast({
      title: t('settings.skills.install.dragNotSupported'),
      variant: 'destructive'
    })
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
    const result = await devicePresenter.selectFiles({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      await tryInstallFromZip(result.filePaths[0])
    }
  } catch (error) {
    showError(error)
  }
}

const handleZipDrop = async (event: DragEvent) => {
  zipDragOver.value = false
  const items = event.dataTransfer?.items
  if (items && items.length > 0) {
    toast({
      title: t('settings.skills.install.dragNotSupported'),
      variant: 'destructive'
    })
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

// URL installation
const installFromUrl = async () => {
  if (!installUrl.value || installing.value) return
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
  result: { success: boolean; error?: string; skillName?: string },
  retryWithOverwrite: () => Promise<void>
) => {
  if (result.success) {
    toast({
      title: t('settings.skills.install.success'),
      description: t('settings.skills.install.successMessage', { name: result.skillName })
    })
    emit('installed')
    isOpen.value = false
  } else if (result.error?.includes('already exists')) {
    const skillName = result.error.match(/"([^"]+)"/)?.[1] || ''
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
