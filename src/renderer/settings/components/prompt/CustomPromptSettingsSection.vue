<template>
  <div class="bg-card border border-border rounded-lg p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:book-open-text" class="w-5 h-5 text-primary" />
        <Label class="text-base font-medium">{{ t('promptSetting.customPrompts') }}</Label>
      </div>
      <div class="flex items-center gap-2">
        <DcButton
          variant="default"
          size="sm"
          icon="lucide:plus"
          :disabled="interactionBlocked || !loaded"
          @click="openCreateDialog"
        >
          {{ t('promptSetting.addCustomPrompt') }}
        </DcButton>
      </div>
    </div>

    <div
      v-if="loadFailed"
      role="alert"
      class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{{ t('common.error.requestFailed') }}</span>
      <DcButton
        variant="link"
        size="sm"
        class="h-auto p-0 text-xs"
        :disabled="interactionBlocked"
        @click="loadPrompts"
      >
        {{ t('common.retry') }}
      </DcButton>
    </div>

    <DcEmpty
      v-if="!loadFailed && prompts.length === 0"
      icon="lucide:book-open-text"
      :title="t('promptSetting.noPrompt')"
      :description="t('promptSetting.noPromptDesc')"
    />

    <div v-else-if="!loadFailed" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                <DcStatusPill status="neutral" :label="getSourceLabel(prompt.source)" />
                <button
                  type="button"
                  :disabled="interactionBlocked"
                  :class="[
                    'text-xs px-2 py-0.5 rounded-md transition-colors',
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
                </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1 shrink-0 ml-2">
            <DcButton
              icon="lucide:pencil"
              size="icon-sm"
              :label="t('common.edit')"
              :tooltip="t('common.edit')"
              :disabled="interactionBlocked"
              @click="editPrompt(index)"
            />

            <DcButton
              icon="lucide:trash-2"
              size="icon-sm"
              :label="t('common.delete')"
              :tooltip="t('common.delete')"
              class="hover:text-destructive hover:bg-destructive/10"
              :disabled="interactionBlocked"
              @click="requestDeletePrompt(prompt.id)"
            />
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
          <DcButton
            v-if="getContent(prompt).length > 100"
            variant="ghost"
            size="sm"
            class="h-6 px-2 text-xs text-primary mt-1"
            @click="toggleShowMore(prompt.id)"
          >
            {{ isExpanded(prompt.id) ? t('promptSetting.showLess') : t('promptSetting.showMore') }}
          </DcButton>
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

    <DcConfirmDialog
      v-model:open="deleteDialogOpen"
      icon="lucide:trash-2"
      :title="t('promptSetting.confirmDelete', { name: pendingDeletePrompt?.name ?? '' })"
      :description="t('promptSetting.confirmDeleteDescription')"
      @confirm="deletePrompt"
    />
  </div>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcEmpty } from '@dc-ui/components/empty'
import { DcStatusPill } from '@dc-ui/components/status-pill'
import { Label } from '@shadcn/components/ui/label'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { usePromptsStore } from '@/stores/prompts'
import PromptEditorSheet from './PromptEditorSheet.vue'
import type { Prompt } from '@shared/types/prompt'
import type { FileItem } from '@shared/types/file'
import { PromptSchema } from '@shared/contracts/domainSchemas'
import { downloadBlob } from '@/lib/download'

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

const props = defineProps<{
  blocked: boolean
}>()

const emit = defineEmits<{
  (e: 'ready-change', value: boolean): void
}>()

const { t } = useI18n()
const promptsStore = usePromptsStore()
const MAX_PROMPT_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_PROMPT_IMPORT_COUNT = 1_000

const prompts = ref<PromptItem[]>([])
const expandedPrompts = ref<Set<string>>(new Set())
const editorOpen = ref(false)
const editingPrompt = ref<PromptForm | null>(null)
const loadFailed = ref(false)
const loaded = ref(false)
const pendingDeletePromptId = ref<string | null>(null)
const interactionBlocked = computed(() => props.blocked)
const pendingDeletePrompt = computed(
  () => prompts.value.find((prompt) => prompt.id === pendingDeletePromptId.value) ?? null
)
const deleteDialogOpen = computed({
  get: () => pendingDeletePromptId.value !== null,
  set: (open: boolean) => {
    if (open) {
      return
    }
    pendingDeletePromptId.value = null
  }
})
let activeImportReader: FileReader | undefined
let disposed = false
let loadGeneration = 0

const getContent = (prompt: PromptItem) => prompt.content ?? ''

const applyPrompts = (items: PromptItem[]) => {
  prompts.value = items.map((prompt) => ({
    ...prompt,
    parameters: prompt.parameters?.map((parameter) => ({ ...parameter })),
    files: prompt.files?.map((file) => ({ ...file })),
    messages: prompt.messages?.map((message) => ({
      ...message,
      content: { ...message.content }
    }))
  }))
}

const logFailure = (operation: string, error: unknown) => {
  console.error(
    '[CustomPromptSettingsSection] Operation failed',
    {
      operation
    },
    error
  )
}

const notifyError = (operation: string, code: string, title: string, error: unknown) => {
  logFailure(operation, error)
  notifyRenderer({ kind: 'error', code, title })
}

const loadPrompts = async (): Promise<boolean> => {
  const generation = ++loadGeneration
  try {
    const canonicalPrompts = await promptsStore.loadPrompts()
    if (disposed || generation !== loadGeneration) {
      return false
    }
    applyPrompts(canonicalPrompts)
    loadFailed.value = false
    loaded.value = true
    emit('ready-change', true)
    return true
  } catch (error) {
    if (disposed || generation !== loadGeneration) {
      return false
    }
    logFailure('load', error)
    loadFailed.value = true
    loaded.value = false
    emit('ready-change', false)
    return false
  }
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
  if (!prompt) {
    return
  }
  const newEnabled = !(prompt.enabled ?? true)

  try {
    applyPrompts(
      await promptsStore.updatePrompt(prompt.id, {
        enabled: newEnabled,
        updatedAt: Date.now()
      })
    )
    notifyRenderer({
      kind: 'success',
      code: newEnabled ? 'settings.prompts.enabled' : 'settings.prompts.disabled',
      title: newEnabled ? t('promptSetting.enableSuccess') : t('promptSetting.disableSuccess')
    })
  } catch (error) {
    notifyError('toggle', 'settings.prompts.toggleFailed', t('promptSetting.toggleFailed'), error)
  }
}

const requestDeletePrompt = (promptId: string) => {
  if (props.blocked || !prompts.value.some((prompt) => prompt.id === promptId)) {
    return
  }
  pendingDeletePromptId.value = promptId
}

const deletePrompt = async () => {
  const prompt = pendingDeletePrompt.value
  if (!prompt) {
    return
  }
  try {
    applyPrompts(await promptsStore.deletePrompt(prompt.id))
    notifyRenderer({
      kind: 'success',
      code: 'settings.prompts.deleted',
      title: t('promptSetting.deleteSuccess')
    })
    pendingDeletePromptId.value = null
  } catch (error) {
    notifyError('delete', 'settings.prompts.deleteFailed', t('promptSetting.deleteFailed'), error)
  }
}

const openCreateDialog = () => {
  if (!loaded.value || props.blocked) {
    return
  }
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
  if (props.blocked) {
    return
  }
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
        id: `${timestamp}-${nanoid(8)}`,
        enabled: prompt.enabled ?? true,
        source: 'local' as const,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      applyPrompts(await promptsStore.addPrompt(toRaw(newPrompt)))
    } else {
      const updatedPrompt = {
        ...prompt,
        updatedAt: timestamp
      }
      applyPrompts(await promptsStore.updatePrompt(prompt.id, toRaw(updatedPrompt)))
    }

    notifyRenderer({
      kind: 'success',
      code: prompt.id ? 'settings.prompts.updated' : 'settings.prompts.added',
      title: t('common.saved')
    })
    editorOpen.value = false
    editingPrompt.value = null
  } catch (error) {
    notifyError('save', 'settings.prompts.saveFailed', t('common.error.operationFailed'), error)
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

const exportPrompts = () => {
  if (!loaded.value) {
    return
  }
  try {
    const data = JSON.stringify(
      prompts.value.map((prompt) => toRaw(prompt)),
      null,
      2
    )
    const blob = new Blob([data], { type: 'application/json' })
    downloadBlob(blob, 'prompts.json')
    notifyRenderer({
      kind: 'success',
      code: 'settings.prompts.exported',
      title: t('promptSetting.exportSuccess')
    })
  } catch (error) {
    notifyError('export', 'settings.prompts.exportFailed', t('promptSetting.exportFailed'), error)
  }
}

const normalizeImportedPrompt = (value: unknown, timestamp: number): PromptItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Imported prompt must be an object')
  }
  const input = value as Record<string, unknown>
  const importedId =
    typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `${timestamp}-${nanoid(8)}`
  const importedName =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
  const parsed = PromptSchema.safeParse({
    id: importedId,
    name: importedName,
    description: typeof input.description === 'string' ? input.description : '',
    content: input.content,
    parameters: input.parameters,
    files: input.files,
    messages: input.messages,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    source: 'imported',
    createdAt: Number.isInteger(input.createdAt) ? input.createdAt : timestamp,
    updatedAt: timestamp
  })
  if (!parsed.success) {
    throw new TypeError('Imported prompt does not match the prompt contract')
  }

  const prompt = parsed.data
  return {
    id: prompt.id,
    name: prompt.name,
    description: prompt.description,
    ...(prompt.content !== undefined ? { content: prompt.content } : {}),
    ...(prompt.parameters
      ? {
          parameters: prompt.parameters.map((item) => ({
            name: item.name,
            description: item.description ?? '',
            required: item.required
          }))
        }
      : {}),
    ...(prompt.files
      ? {
          files: prompt.files.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            size: Number.isFinite(item.size) && (item.size ?? 0) >= 0 ? (item.size ?? 0) : 0,
            // Imported paths are untrusted and must never become deferred local-file reads.
            path: '',
            ...(item.description !== undefined ? { description: item.description } : {}),
            ...(item.content !== undefined ? { content: item.content } : {}),
            createdAt: item.createdAt ?? timestamp
          }))
        }
      : {}),
    ...(prompt.messages
      ? {
          messages: prompt.messages.map((item) => ({
            ...item,
            content: { ...item.content }
          }))
        }
      : {}),
    enabled: prompt.enabled ?? true,
    source: prompt.source ?? 'imported',
    createdAt: prompt.createdAt ?? timestamp,
    updatedAt: timestamp
  }
}

const importPrompts = () => {
  if (!loaded.value || interactionBlocked.value) {
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (file.size > MAX_PROMPT_IMPORT_BYTES) {
      notifyRenderer({
        kind: 'error',
        code: 'settings.prompts.importTooLarge',
        title: t('promptSetting.importFailed')
      })
      return
    }

    const reader = new FileReader()
    activeImportReader = reader
    reader.onload = async (e) => {
      activeImportReader = undefined
      if (disposed) return
      try {
        const content = e.target?.result as string
        const importedPrompts: unknown = JSON.parse(content)

        if (!Array.isArray(importedPrompts) || importedPrompts.length > MAX_PROMPT_IMPORT_COUNT) {
          throw new TypeError('Imported prompt payload must be a bounded array')
        }

        const currentPrompts = prompts.value.map((prompt) => ({ ...prompt }))
        const indexById = new Map(currentPrompts.map((prompt, index) => [prompt.id, index]))
        let updatedCount = 0
        let addedCount = 0

        for (const value of importedPrompts) {
          const importedPrompt = normalizeImportedPrompt(value, Date.now())
          const existingIndex = indexById.get(importedPrompt.id)
          if (existingIndex !== undefined) {
            currentPrompts[existingIndex] = importedPrompt
            updatedCount += 1
          } else {
            indexById.set(importedPrompt.id, currentPrompts.length)
            currentPrompts.push(importedPrompt)
            addedCount += 1
          }
        }

        const savedPrompts = await promptsStore.savePrompts(currentPrompts)
        if (disposed) return
        applyPrompts(savedPrompts)
        notifyRenderer({
          kind: 'success',
          code: 'settings.prompts.imported',
          title: t('promptSetting.importSuccess'),
          description: t('promptSetting.importStats', { added: addedCount, updated: updatedCount })
        })
      } catch (error) {
        notifyError(
          'import',
          'settings.prompts.importFailed',
          t('promptSetting.importFailed'),
          error
        )
      }
    }

    reader.onerror = () => {
      activeImportReader = undefined
      if (disposed) return
      notifyError(
        'import-read',
        'settings.prompts.importFailed',
        t('promptSetting.importFailed'),
        reader.error
      )
    }
    reader.onabort = () => {
      activeImportReader = undefined
    }

    try {
      reader.readAsText(file)
    } catch (error) {
      activeImportReader = undefined
      notifyError(
        'import-read',
        'settings.prompts.importFailed',
        t('promptSetting.importFailed'),
        error
      )
    }
  }

  input.click()
}

onMounted(async () => {
  await loadPrompts()
})

onBeforeUnmount(() => {
  disposed = true
  loadGeneration += 1
  activeImportReader?.abort()
  emit('ready-change', false)
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
