<template>
  <div class="space-y-3">
    <div class="flex flex-row items-center gap-2">
      <div class="flex-1">
        <Label class="text-sm font-medium flex-1">
          {{ t('promptSetting.defaultSystemPrompt') }}
        </Label>
        <p class="text-xs text-muted-foreground">
          {{ t('promptSetting.systemPromptDescription') }}
        </p>
      </div>

      <Select
        :model-value="selectedSystemPromptId"
        :disabled="currentPromptDirty || !loaded"
        @update:model-value="handleSystemPromptChange"
      >
        <SelectTrigger class="w-32 border-border hover:bg-accent h-8!">
          <SelectValue :placeholder="t('promptSetting.selectSystemPrompt')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="prompt in selectableSystemPrompts" :key="prompt.id" :value="prompt.id">
            {{ prompt.name }}
          </SelectItem>
        </SelectContent>
      </Select>
      <DcButton
        icon="lucide:plus"
        size="icon-sm"
        :label="t('promptSetting.addSystemPrompt')"
        :tooltip="t('promptSetting.addSystemPrompt')"
        :disabled="currentPromptDirty || !loaded"
        @click="openCreatePrompt"
      />
    </div>

    <div
      v-if="loadFailed"
      role="alert"
      class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{{ t('common.error.requestFailed') }}</span>
      <DcButton variant="link" size="sm" class="h-auto p-0 text-xs" @click="loadSystemPrompts">
        {{ t('common.retry') }}
      </DcButton>
    </div>

    <div v-if="isEmptyPromptSelected" class="rounded-md border border-dashed border-border p-3">
      <p class="text-xs text-muted-foreground">
        {{ t('promptSetting.emptySystemPromptDescription') }}
      </p>
    </div>

    <div v-else-if="currentSystemPrompt" class="space-y-2">
      <Textarea
        :model-value="currentSystemPrompt.content"
        class="w-full h-48"
        :placeholder="t('promptSetting.contentPlaceholder')"
        @update:model-value="updateCurrentPromptContent"
        @blur="saveCurrentSystemPrompt"
      />
      <div class="flex items-center gap-2">
        <DcButton
          v-if="currentSystemPrompt.id === 'default'"
          variant="outline"
          size="sm"
          icon="lucide:rotate-ccw"
          :disabled="currentPromptDirty"
          @click="resetDefaultSystemPrompt"
        >
          {{ t('promptSetting.resetToDefault') }}
        </DcButton>
        <DcButton
          v-else
          variant="outline"
          size="sm"
          icon="lucide:trash-2"
          class="text-destructive hover:bg-destructive hover:text-destructive-foreground"
          :disabled="currentPromptDirty"
          @click="requestDeleteSystemPrompt(currentSystemPrompt.id)"
        >
          {{ t('common.delete') }}
        </DcButton>
      </div>
    </div>

    <SystemPromptEditorSheet
      :open="systemPromptEditorOpen"
      :prompt="editingSystemPrompt"
      @update:open="handleEditorOpenChange"
      @save="handleSaveSystemPrompt"
    />

    <DcConfirmDialog
      :open="deleteDialogOpen"
      icon="lucide:trash-2"
      :title="
        t('promptSetting.confirmDeleteSystemPrompt', {
          name: pendingDeleteSystemPrompt?.name ?? ''
        })
      "
      :description="t('promptSetting.confirmDeleteSystemPromptDescription')"
      @update:open="handleDeleteDialogOpenChange"
      @confirm="deleteSystemPrompt"
    />
  </div>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import type { AcceptableValue } from 'reka-ui'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import SystemPromptEditorSheet from './SystemPromptEditorSheet.vue'
import { useSystemPromptStore } from '@/stores/systemPromptStore'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'
import type { SystemPrompt } from '@shared/types/prompt'

const emit = defineEmits<{
  (e: 'dirty-change', value: boolean): void
}>()

const { t } = useI18n()
const systemPromptStore = useSystemPromptStore()

const EMPTY_SYSTEM_PROMPT_ID = 'empty'

const systemPrompts = ref<SystemPrompt[]>([])
const selectedSystemPromptId = ref('')
const currentSystemPrompt = ref<SystemPrompt | null>(null)
const systemPromptEditorOpen = ref(false)
const editingSystemPrompt = ref<SystemPrompt | null>(null)
const pendingDeleteSystemPromptId = ref<string | null>(null)
const loadFailed = ref(false)
const loaded = ref(false)
const persistedPrompts = new Map<string, SystemPrompt>()
let loadGeneration = 0
let disposed = false

const emptySystemPromptOption = computed<SystemPrompt>(() => ({
  id: EMPTY_SYSTEM_PROMPT_ID,
  name: t('promptSetting.emptySystemPromptOption'),
  content: ''
}))

const selectableSystemPrompts = computed(() => [
  emptySystemPromptOption.value,
  ...systemPrompts.value
])

const isEmptyPromptSelected = computed(
  () => selectedSystemPromptId.value === EMPTY_SYSTEM_PROMPT_ID
)
const currentPromptDirty = computed(() => {
  const prompt = currentSystemPrompt.value
  if (!prompt) return false
  return persistedPrompts.get(prompt.id)?.content !== prompt.content
})
const pendingDeleteSystemPrompt = computed(
  () =>
    systemPrompts.value.find((prompt) => prompt.id === pendingDeleteSystemPromptId.value) ?? null
)
const deleteDialogOpen = computed(() => pendingDeleteSystemPromptId.value !== null)

const clonePrompt = (prompt: SystemPrompt): SystemPrompt => ({ ...prompt })

const logFailure = (operation: string, error: unknown) => {
  console.error(
    '[SystemPromptSettingsSection] Operation failed',
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

const applySystemPromptState = (state: { prompts: SystemPrompt[]; defaultPromptId: string }) => {
  const canonicalPrompts = state.prompts.map(clonePrompt)
  persistedPrompts.clear()
  for (const prompt of canonicalPrompts) {
    persistedPrompts.set(prompt.id, clonePrompt(prompt))
  }
  systemPrompts.value = canonicalPrompts
  selectedSystemPromptId.value = state.defaultPromptId
  updateCurrentSystemPrompt()
}

const loadSystemPrompts = async () => {
  const generation = ++loadGeneration
  try {
    const state = await systemPromptStore.loadPrompts()
    if (disposed || generation !== loadGeneration) {
      return
    }
    applySystemPromptState(state)
    loadFailed.value = false
    loaded.value = true
  } catch (error) {
    if (disposed || generation !== loadGeneration) {
      return
    }
    logFailure('load', error)
    loadFailed.value = true
    loaded.value = false
  }
}

const updateCurrentSystemPrompt = () => {
  if (isEmptyPromptSelected.value) {
    currentSystemPrompt.value = null
    return
  }

  const prompt = systemPrompts.value.find((item) => item.id === selectedSystemPromptId.value)
  currentSystemPrompt.value = prompt ? clonePrompt(prompt) : null
}

const updateCurrentPromptContent = (value: string | number) => {
  if (!currentSystemPrompt.value) return
  currentSystemPrompt.value.content = String(value)
}

const handleSystemPromptChange = async (promptId: AcceptableValue) => {
  const id = String(promptId)
  if (
    currentPromptDirty.value ||
    !selectableSystemPrompts.value.some((prompt) => prompt.id === id)
  ) {
    return
  }
  try {
    applySystemPromptState(await systemPromptStore.setDefaultSystemPromptId(id))
    notifyRenderer({
      kind: 'success',
      code: 'settings.systemPrompts.changed',
      title: t('promptSetting.systemPromptChanged')
    })
  } catch (error) {
    notifyError(
      'change',
      'settings.systemPrompts.changeFailed',
      t('promptSetting.systemPromptChangeFailed'),
      error
    )
  }
}

const saveCurrentSystemPrompt = async () => {
  const prompt = currentSystemPrompt.value
  if (!prompt || !currentPromptDirty.value) {
    return
  }

  try {
    applySystemPromptState(
      await systemPromptStore.updateSystemPrompt(prompt.id, {
        content: prompt.content,
        updatedAt: Date.now()
      })
    )
    notifyRenderer({
      kind: 'success',
      code: 'settings.systemPrompts.updated',
      title: t('promptSetting.systemPromptUpdated')
    })
  } catch (error) {
    notifyError(
      'save',
      'settings.systemPrompts.saveFailed',
      t('promptSetting.systemPromptSaveFailed'),
      error
    )
  }
}

const resetDefaultSystemPrompt = async () => {
  if (currentPromptDirty.value || currentSystemPrompt.value?.id !== 'default') {
    return
  }

  try {
    applySystemPromptState(await systemPromptStore.resetToDefaultPrompt())
    notifyRenderer({
      kind: 'success',
      code: 'settings.systemPrompts.reset',
      title: t('promptSetting.resetToDefaultSuccess')
    })
  } catch (error) {
    notifyError(
      'reset',
      'settings.systemPrompts.resetFailed',
      t('promptSetting.resetToDefaultFailed'),
      error
    )
  }
}

const requestDeleteSystemPrompt = (promptId: string) => {
  if (currentPromptDirty.value || !systemPrompts.value.some((prompt) => prompt.id === promptId)) {
    return
  }
  pendingDeleteSystemPromptId.value = promptId
}

const handleDeleteDialogOpenChange = (open: boolean) => {
  if (open) {
    return
  }
  pendingDeleteSystemPromptId.value = null
}

const deleteSystemPrompt = async () => {
  const prompt = pendingDeleteSystemPrompt.value
  if (!prompt) {
    return
  }

  try {
    applySystemPromptState(await systemPromptStore.deleteSystemPrompt(prompt.id))
    notifyRenderer({
      kind: 'success',
      code: 'settings.systemPrompts.deleted',
      title: t('promptSetting.systemPromptDeleted')
    })
    pendingDeleteSystemPromptId.value = null
  } catch (error) {
    notifyError(
      'delete',
      'settings.systemPrompts.deleteFailed',
      t('promptSetting.systemPromptDeleteFailed'),
      error
    )
  }
}

const openCreatePrompt = () => {
  if (!loaded.value || currentPromptDirty.value) {
    return
  }
  editingSystemPrompt.value = null
  systemPromptEditorOpen.value = true
}

const handleEditorOpenChange = (open: boolean) => {
  systemPromptEditorOpen.value = open
  if (!open) {
    editingSystemPrompt.value = null
  }
}

const handleSaveSystemPrompt = async ({
  id,
  name,
  content
}: {
  id?: string
  name: string
  content: string
}) => {
  const timestamp = Date.now()

  try {
    if (id) {
      applySystemPromptState(
        await systemPromptStore.updateSystemPrompt(id, {
          name,
          content,
          updatedAt: timestamp
        })
      )
    } else {
      const newId = `${timestamp}-${nanoid(8)}`
      applySystemPromptState(
        await systemPromptStore.addSystemPrompt({
          id: newId,
          name,
          content,
          isDefault: false,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      )
      try {
        applySystemPromptState(await systemPromptStore.setDefaultSystemPromptId(newId))
      } catch (error) {
        systemPromptEditorOpen.value = false
        editingSystemPrompt.value = null
        notifyError(
          'activate-created',
          'settings.systemPrompts.changeFailed',
          t('promptSetting.systemPromptChangeFailed'),
          error
        )
        return
      }
    }

    systemPromptEditorOpen.value = false
    editingSystemPrompt.value = null
    notifyRenderer({
      kind: 'success',
      code: id ? 'settings.systemPrompts.updated' : 'settings.systemPrompts.added',
      title: id
        ? t('promptSetting.systemPromptUpdated')
        : t('promptSetting.systemPromptAddedAndSwitched')
    })
  } catch (error) {
    notifyError(
      'editor-save',
      'settings.systemPrompts.saveFailed',
      t('promptSetting.systemPromptSaveFailed'),
      error
    )
  }
}

const restoreCurrentPrompt = () => {
  const currentId = currentSystemPrompt.value?.id
  if (currentId) {
    const persisted = persistedPrompts.get(currentId)
    currentSystemPrompt.value = persisted ? clonePrompt(persisted) : null
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: 'settings.systemPrompts.save',
  onDiscard: restoreCurrentPrompt
})
const stopDirtySync = watch(
  currentPromptDirty,
  (dirty) => {
    leaveGuardLease.setRisk(dirty ? 'dirty' : 'clean')
    emit('dirty-change', dirty)
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  void loadSystemPrompts()
})

onBeforeUnmount(() => {
  disposed = true
  loadGeneration += 1
  stopDirtySync()
  leaveGuardLease.release()
  emit('dirty-change', false)
})
</script>
