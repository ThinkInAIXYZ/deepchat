<template>
  <div class="bg-card border border-border rounded-lg p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:book-open-text" class="w-5 h-5 text-primary" />
        <Label class="text-base font-medium">{{ t('promptSetting.customPrompts') }}</Label>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="default" size="sm" @click="openCreateDialog">
          <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
          {{ t('promptSetting.addCustomPrompt') }}
        </Button>
      </div>
    </div>

    <div v-if="prompts.length === 0" class="text-center text-muted-foreground py-12">
      <Icon icon="lucide:book-open-text" class="w-12 h-12 mx-auto mb-4 opacity-50" />
      <p class="text-lg font-medium">{{ t('promptSetting.noPrompt') }}</p>
      <p class="text-sm mt-1">{{ t('promptSetting.noPromptDesc') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="(prompt, index) in prompts"
        :key="prompt.id"
        class="bg-muted border border-border rounded-lg p-4 hover:border-primary/50 transition-colors duration-200"
      >
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="p-2 bg-primary/10 rounded-lg shrink-0">
              <Icon icon="lucide:scroll-text" class="w-5 h-5 text-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm truncate" :title="prompt.name">
                {{ prompt.name }}
              </div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs px-2 py-0.5 bg-muted rounded-md text-muted-foreground">
                  {{ getSourceLabel(prompt.source) }}
                </span>
                <span
                  :class="[
                    'text-xs px-2 py-0.5 rounded-md cursor-pointer transition-colors',
                    prompt.enabled
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  ]"
                  :title="
                    prompt.enabled
                      ? t('promptSetting.clickToDisable')
                      : t('promptSetting.clickToEnable')
                  "
                  @click="togglePromptEnabled(index)"
                >
                  {{ prompt.enabled ? t('promptSetting.active') : t('promptSetting.inactive') }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0 ml-2">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
              :title="t('common.edit')"
              @click="editPrompt(index)"
            >
              <Icon icon="lucide:pencil" class="w-3.5 h-3.5" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  :title="t('common.delete')"
                >
                  <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{{
                    t('promptSetting.confirmDelete', { name: prompt.name })
                  }}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t('promptSetting.confirmDeleteDescription') }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                  <AlertDialogAction @click="deletePrompt(index)">
                    {{ t('common.confirm') }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div class="text-xs text-muted-foreground mb-3 line-clamp-2" :title="prompt.description">
          {{ prompt.description || t('promptSetting.noDescription') }}
        </div>

        <div class="relative mb-3">
          <div
            :class="[
              'text-xs bg-muted/50 rounded-md p-2 border text-muted-foreground break-all',
              !isExpanded(prompt.id) && 'line-clamp-2'
            ]"
          >
            {{ getContent(prompt) }}
          </div>
          <Button
            v-if="getContent(prompt).length > 100"
            variant="ghost"
            size="sm"
            class="text-xs text-primary h-6 px-2 mt-1"
            @click="toggleShowMore(prompt.id)"
          >
            {{ isExpanded(prompt.id) ? t('promptSetting.showLess') : t('promptSetting.showMore') }}
          </Button>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-border">
          <div class="flex items-center gap-4 text-xs text-muted-foreground">
            <div class="flex items-center gap-1">
              <Icon icon="lucide:type" class="w-3 h-3" />
              <span>{{ getContent(prompt).length }}</span>
            </div>
            <div v-if="prompt.parameters?.length" class="flex items-center gap-1">
              <Icon icon="lucide:settings" class="w-3 h-3" />
              <span>{{ prompt.parameters.length }}</span>
            </div>
          </div>
          <div class="text-xs text-muted-foreground">
            {{ formatDate(prompt.id) }}
          </div>
        </div>
      </div>
    </div>

    <PromptEditorSheet
      :open="editorOpen"
      :prompt="editingPrompt"
      @update:open="handleEditorOpenChange"
      @submit="handleEditorSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { useToast } from '@/components/use-toast'
import { usePromptsStore } from '@/stores/prompts'
import { toRaw } from 'vue'
import PromptEditorSheet from './PromptEditorSheet.vue'
import type { Prompt, FileItem } from '@shared/presenter'
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

interface PromptParameter {
  name: string
  description: string
  required: boolean
}

type PromptItem = Prompt

interface PromptForm extends PromptItem {
  content: string
  parameters: PromptParameter[]
  files: FileItem[]
  enabled: boolean
  source: 'local' | 'imported' | 'builtin'
}

const { t } = useI18n()
const { toast } = useToast()
const promptsStore = usePromptsStore()

const prompts = ref<PromptItem[]>([])
const expandedPrompts = ref<Set<string>>(new Set())
const editorOpen = ref(false)
const editingPrompt = ref<PromptForm | null>(null)

const getContent = (prompt: PromptItem) => prompt.content ?? ''

const loadPrompts = async () => {
  await promptsStore.loadPrompts()
  prompts.value = promptsStore.prompts.map((prompt) => ({ ...prompt }))
}

const isExpanded = (id: string) => expandedPrompts.value.has(id)

const toggleShowMore = (id: string) => {
  if (expandedPrompts.value.has(id)) {
    expandedPrompts.value.delete(id)
  } else {
    expandedPrompts.value.add(id)
  }
}

const togglePromptEnabled = async (index: number) => {
  const prompt = prompts.value[index]
  const newEnabled = !(prompt.enabled ?? true)
  prompts.value[index] = { ...prompt, enabled: newEnabled }

  try {
    await promptsStore.updatePrompt(prompt.id, {
      enabled: newEnabled,
      updatedAt: Date.now()
    })
    toast({
      title: newEnabled ? t('promptSetting.enableSuccess') : t('promptSetting.disableSuccess'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to toggle prompt:', error)
    await loadPrompts()
    toast({
      title: t('promptSetting.toggleFailed'),
      variant: 'destructive'
    })
  }
}

const deletePrompt = async (index: number) => {
  const prompt = prompts.value[index]
  try {
    await promptsStore.deletePrompt(prompt.id)
    await loadPrompts()
    toast({
      title: t('promptSetting.deleteSuccess'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to delete prompt:', error)
    toast({
      title: t('promptSetting.deleteFailed'),
      variant: 'destructive'
    })
  }
}

const openCreateDialog = () => {
  editingPrompt.value = null
  editorOpen.value = true
}

const toPromptForm = (prompt: PromptItem): PromptForm => ({
  id: prompt.id,
  name: prompt.name,
  description: prompt.description,
  content: prompt.content ?? '',
  parameters: prompt.parameters ? prompt.parameters.map((param) => ({ ...param })) : [],
  files: prompt.files ? [...prompt.files] : [],
  enabled: prompt.enabled ?? true,
  source: prompt.source ?? 'local',
  createdAt: prompt.createdAt,
  updatedAt: prompt.updatedAt
})

const editPrompt = (index: number) => {
  const prompt = prompts.value[index]
  editingPrompt.value = toPromptForm(prompt)
  editorOpen.value = true
}

const handleEditorOpenChange = (open: boolean) => {
  editorOpen.value = open
  if (!open) {
    editingPrompt.value = null
  }
}

const handleEditorSubmit = async (prompt: PromptForm) => {
  const timestamp = Date.now()

  try {
    if (!prompt.id) {
      const newPrompt = {
        ...prompt,
        id: timestamp.toString(),
        enabled: prompt.enabled ?? true,
        source: 'local' as const,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await promptsStore.addPrompt(toRaw(newPrompt))
    } else {
      const updatedPrompt = {
        ...prompt,
        updatedAt: timestamp
      }
      await promptsStore.updatePrompt(prompt.id, toRaw(updatedPrompt))
    }

    await loadPrompts()
    editorOpen.value = false
    editingPrompt.value = null
  } catch (error) {
    console.error('Failed to save prompt:', error)
  }
}

const formatDate = (id: string) => {
  try {
    const timestamp = parseInt(id)
    if (isNaN(timestamp)) {
      return t('promptSetting.customDate')
    }
    return new Date(timestamp).toLocaleDateString()
  } catch {
    return t('promptSetting.customDate')
  }
}

const getSourceLabel = (source?: string) => {
  switch (source) {
    case 'local':
      return t('promptSetting.sourceLocal')
    case 'imported':
      return t('promptSetting.sourceImported')
    case 'builtin':
      return t('promptSetting.sourceBuiltin')
    default:
      return t('promptSetting.sourceLocal')
  }
}

const safeClone = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => safeClone(item))
  }

  const cloned: Record<string, unknown> = {}
  for (const key in obj as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = (obj as Record<string, unknown>)[key]
      if (
        typeof value !== 'function' &&
        typeof value !== 'symbol' &&
        typeof value !== 'undefined'
      ) {
        cloned[key] = safeClone(value)
      }
    }
  }
  return cloned
}

const exportPrompts = () => {
  try {
    const data = JSON.stringify(
      prompts.value.map((prompt) => toRaw(prompt)),
      null,
      2
    )
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompts.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast({
      title: t('promptSetting.exportSuccess'),
      variant: 'default'
    })
  } catch (error) {
    console.error('Failed to export prompts:', error)
    toast({
      title: t('promptSetting.exportFailed'),
      variant: 'destructive'
    })
  }
}

const importPrompts = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string
        const importedPrompts = JSON.parse(content)

        if (!Array.isArray(importedPrompts)) {
          throw new Error('Invalid format: not an array')
        }

        const currentPrompts = [...prompts.value]
        const currentMap = new Map(currentPrompts.map((prompt) => [prompt.id, prompt]))
        let updatedCount = 0
        let addedCount = 0

        for (const importedPrompt of importedPrompts) {
          const timestamp = Date.now()

          if (!importedPrompt.id) {
            importedPrompt.id = `${timestamp}${Math.random().toString(36).slice(2, 11)}`
          }

          if (!importedPrompt.source) {
            importedPrompt.source = 'imported'
          }

          if (importedPrompt.enabled === undefined) {
            importedPrompt.enabled = true
          }

          if (!importedPrompt.createdAt) {
            importedPrompt.createdAt = timestamp
          }

          importedPrompt.updatedAt = timestamp

          if (currentMap.has(importedPrompt.id)) {
            const idx = currentPrompts.findIndex((prompt) => prompt.id === importedPrompt.id)
            if (idx !== -1) {
              currentPrompts[idx] = importedPrompt
              updatedCount++
            }
          } else {
            currentPrompts.push(importedPrompt)
            addedCount++
          }
        }

        const rawPrompts = currentPrompts.map((prompt) => safeClone(toRaw(prompt)) as PromptItem)
        await promptsStore.savePrompts(rawPrompts as PromptItem[])
        await loadPrompts()

        toast({
          title: t('promptSetting.importSuccess'),
          description: t('promptSetting.importStats', { added: addedCount, updated: updatedCount }),
          variant: 'default'
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        toast({
          title: t('promptSetting.importFailed'),
          description: `错误: ${errorMessage}`,
          variant: 'destructive'
        })
      }
    }

    reader.onerror = () => {
      toast({
        title: t('promptSetting.importFailed'),
        description: '文件读取失败',
        variant: 'destructive'
      })
    }

    reader.readAsText(file)
  }

  input.click()
}

onMounted(async () => {
  await loadPrompts()
})

defineExpose({
  importPrompts,
  exportPrompts
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
