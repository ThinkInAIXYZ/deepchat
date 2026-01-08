<template>
  <div class="w-full h-full flex flex-col">
    <!-- Header section -->
    <div class="shrink-0 px-4 pt-4">
      <div class="flex items-center justify-between">
        <div :dir="languageStore.dir" class="flex-1">
          <div class="font-medium">
            {{ t('settings.skills.title') }}
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.skills.description') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="openSkillsFolder">
            <Icon icon="lucide:folder-open" class="w-4 h-4 mr-1" />
            {{ t('settings.skills.openFolder') }}
          </Button>
          <Dialog v-model:open="installDialogOpen">
            <DialogTrigger asChild>
              <Button size="sm">
                <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
                {{ t('settings.skills.addSkill') }}
              </Button>
            </DialogTrigger>
            <DialogContent class="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{{ t('settings.skills.install.title') }}</DialogTitle>
                <DialogDescription>
                  {{ t('settings.skills.install.description') }}
                </DialogDescription>
              </DialogHeader>
              <div class="space-y-4 py-4">
                <Button variant="outline" class="w-full" @click="selectFolderToInstall">
                  <Icon icon="lucide:folder" class="w-4 h-4 mr-2" />
                  {{ t('settings.skills.install.fromFolder') }}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>

    <Separator class="my-4" />

    <!-- Skills list -->
    <ScrollArea class="flex-1 px-4">
      <div v-if="loading" class="flex items-center justify-center py-8">
        <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="skills.length === 0" class="flex flex-col items-center justify-center py-8">
        <Icon icon="lucide:wand-sparkles" class="w-12 h-12 text-muted-foreground/50 mb-4" />
        <p class="text-muted-foreground text-sm">{{ t('settings.skills.empty') }}</p>
        <p class="text-muted-foreground/70 text-xs mt-1">{{ t('settings.skills.emptyHint') }}</p>
      </div>

      <div v-else class="space-y-3 pb-4">
        <div
          v-for="skill in skills"
          :key="skill.name"
          class="border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <Icon icon="lucide:wand-sparkles" class="w-4 h-4 text-primary shrink-0" />
                <span class="font-medium truncate">{{ skill.name }}</span>
              </div>
              <p class="text-sm text-muted-foreground mt-1 line-clamp-2">
                {{ skill.description }}
              </p>
              <div class="flex items-center gap-2 mt-2 text-xs text-muted-foreground/70">
                <Icon icon="lucide:folder" class="w-3 h-3" />
                <span class="truncate">{{ skill.skillRoot }}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 ml-2 shrink-0">
              <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="openSkillEditor(skill)">
                <Icon icon="lucide:edit" class="w-4 h-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" class="h-8 w-8 p-0 text-destructive">
                    <Icon icon="lucide:trash-2" class="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{{ t('settings.skills.delete.title') }}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {{
                        t('settings.skills.delete.description', {
                          name: skill.name
                        })
                      }}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                    <AlertDialogAction
                      class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      @click="handleUninstall(skill.name)"
                    >
                      {{ t('common.delete') }}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- Edit skill sheet -->
    <Sheet v-model:open="editorOpen">
      <SheetContent class="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{{ t('settings.skills.edit.title') }}</SheetTitle>
          <SheetDescription>
            {{ editingSkill?.name }}
          </SheetDescription>
        </SheetHeader>
        <div class="mt-4 flex-1 overflow-hidden">
          <Textarea
            v-model="editingContent"
            class="w-full h-[calc(100vh-200px)] font-mono text-sm resize-none"
            :placeholder="t('settings.skills.edit.placeholder')"
          />
        </div>
        <SheetFooter class="mt-4">
          <Button variant="outline" @click="editorOpen = false">
            {{ t('common.cancel') }}
          </Button>
          <Button @click="saveSkillEdit" :disabled="saving">
            <Icon v-if="saving" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('common.save') }}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Separator } from '@shadcn/components/ui/separator'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@shadcn/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { useLanguageStore } from '@/stores/language'
import { usePresenter } from '@/composables/usePresenter'
import type { SkillMetadata } from '@shared/types/skill'

const { t } = useI18n()
const { toast } = useToast()
const skillsStore = useSkillsStore()
const languageStore = useLanguageStore()
const devicePresenter = usePresenter('devicePresenter')

const { skills, loading } = storeToRefs(skillsStore)

const installDialogOpen = ref(false)
const editorOpen = ref(false)
const editingSkill = ref<SkillMetadata | null>(null)
const editingContent = ref('')
const saving = ref(false)

onMounted(async () => {
  await skillsStore.loadSkills()
})

const openSkillsFolder = async () => {
  await skillsStore.openSkillsFolder()
}

const selectFolderToInstall = async () => {
  try {
    const result = await devicePresenter.selectDirectory()

    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0]
      const installResult = await skillsStore.installFromFolder(folderPath)

      if (installResult.success) {
        toast({
          title: t('settings.skills.install.success'),
          description: t('settings.skills.install.successMessage', {
            name: installResult.skillName
          })
        })
        installDialogOpen.value = false
      } else {
        toast({
          title: t('settings.skills.install.failed'),
          description: installResult.error,
          variant: 'destructive'
        })
      }
    }
  } catch (error) {
    console.error('Failed to install skill:', error)
    toast({
      title: t('settings.skills.install.failed'),
      description: String(error),
      variant: 'destructive'
    })
  }
}

const handleUninstall = async (name: string) => {
  const result = await skillsStore.uninstallSkill(name)
  if (result.success) {
    toast({
      title: t('settings.skills.delete.success'),
      description: t('settings.skills.delete.successMessage', { name })
    })
  } else {
    toast({
      title: t('settings.skills.delete.failed'),
      description: result.error,
      variant: 'destructive'
    })
  }
}

const openSkillEditor = async (skill: SkillMetadata) => {
  editingSkill.value = skill
  try {
    const filePresenter = usePresenter('filePresenter')
    const content = await filePresenter.readFile(skill.path)
    editingContent.value = content
    editorOpen.value = true
  } catch (error) {
    console.error('Failed to read skill file:', error)
    toast({
      title: t('settings.skills.edit.readFailed'),
      description: String(error),
      variant: 'destructive'
    })
  }
}

const saveSkillEdit = async () => {
  if (!editingSkill.value) return

  saving.value = true
  try {
    const result = await skillsStore.updateSkillFile(editingSkill.value.name, editingContent.value)
    if (result.success) {
      toast({
        title: t('settings.skills.edit.success')
      })
      editorOpen.value = false
    } else {
      toast({
        title: t('settings.skills.edit.failed'),
        description: result.error,
        variant: 'destructive'
      })
    }
  } catch (error) {
    toast({
      title: t('settings.skills.edit.failed'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    saving.value = false
  }
}
</script>
