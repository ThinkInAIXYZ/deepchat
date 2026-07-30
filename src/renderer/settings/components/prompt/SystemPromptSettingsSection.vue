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
        :disabled="systemWriteBlocked || currentPromptDirty || !loaded"
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
      <Button
        variant="outline"
        size="icon-sm"
        :disabled="systemWriteBlocked || currentPromptDirty || !loaded"
        @click="openCreatePrompt"
      >
        <Icon icon="lucide:plus" class="w-4 h-4" />
      </Button>
    </div>

    <div
      v-if="loadFailed"
      role="alert"
      class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{{ t('common.error.requestFailed') }}</span>
      <Button
        variant="link"
        size="sm"
        class="h-auto p-0 text-xs"
        :disabled="systemWriteBlocked"
        @click="loadSystemPrompts"
      >
        {{ t('common.retry') }}
      </Button>
    </div>

    <div v-if="isEmptyPromptSelected" class="rounded-md border border-dashed border-border p-3">
      <p class="text-xs text-muted-foreground">
        {{ t('promptSetting.emptySystemPromptDescription') }}
      </p>
    </div>

    <div v-else-if="currentSystemPrompt" class="space-y-2">
      <Textarea
        :model-value="currentSystemPrompt.content"
        :disabled="operationPending"
        class="w-full h-48"
        :placeholder="t('promptSetting.contentPlaceholder')"
        @update:model-value="updateCurrentPromptContent"
        @blur="saveCurrentSystemPrompt"
      />
      <div class="flex items-center gap-2">
        <Button
          v-if="currentPromptDirty && feedback.status === 'error'"
          variant="outline"
          size="sm"
          :disabled="systemWriteBlocked"
          @click="saveCurrentSystemPrompt"
        >
          {{ t('common.retry') }}
        </Button>
        <Button
          v-if="currentSystemPrompt.id === 'default'"
          variant="outline"
          size="sm"
          :disabled="systemWriteBlocked || currentPromptDirty"
          @click="resetDefaultSystemPrompt"
        >
          <Icon icon="lucide:rotate-ccw" class="w-3.5 h-3.5 mr-1" />
          {{ t('promptSetting.resetToDefault') }}
        </Button>
        <Button
          v-else
          variant="outline"
          size="sm"
          class="text-destructive hover:bg-destructive hover:text-destructive-foreground"
          :disabled="systemWriteBlocked || currentPromptDirty"
          @click="requestDeleteSystemPrompt(currentSystemPrompt.id)"
        >
          <Icon icon="lucide:trash-2" class="w-3.5 h-3.5 mr-1" />
          {{ t('common.delete') }}
        </Button>
      </div>
    </div>

    <SystemPromptEditorSheet
      :open="systemPromptEditorOpen"
      :prompt="editingSystemPrompt"
      :pending="operationPending"
      :feedback="feedback"
      @update:open="handleEditorOpenChange"
      @save="handleSaveSystemPrompt"
    />

    <Dialog :open="deleteDialogOpen" @update:open="handleDeleteDialogOpenChange">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{
              t('promptSetting.confirmDeleteSystemPrompt', {
                name: pendingDeleteSystemPrompt?.name ?? ''
              })
            }}
          </DialogTitle>
          <DialogDescription>
            {{ t('promptSetting.confirmDeleteSystemPromptDescription') }}
          </DialogDescription>
        </DialogHeader>
        <InlineOperationFeedback :snapshot="feedback" />
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="operationPending"
            @click="handleDeleteDialogOpenChange(false)"
          >
            {{ t('common.cancel') }}
          </Button>
          <Button variant="destructive" :disabled="operationPending" @click="deleteSystemPrompt">
            {{ t('common.confirm') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Label } from '@shadcn/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import type { AcceptableValue } from 'reka-ui'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import type {
  SurfaceFeedbackController,
  SurfaceFeedbackSnapshot
} from '@renderer-notifications/surfaceFeedbackController'
import SystemPromptEditorSheet from './SystemPromptEditorSheet.vue'
import { useSystemPromptStore } from '@/stores/systemPromptStore'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'
import type { SystemPrompt } from '@shared/types/prompt'

const props = defineProps<{
  feedbackController: SurfaceFeedbackController
  feedback: SurfaceFeedbackSnapshot
  blocked: boolean
}>()

const emit = defineEmits<{
  (e: 'dirty-change', value: boolean): void
  (e: 'feedback-surface', value: boolean): void
}>()

const { t } = useI18n()
const systemPromptStore = useSystemPromptStore()

const EMPTY_SYSTEM_PROMPT_ID = 'empty'
const operationScope = nanoid(8)
const operationIds = Object.freeze({
  change: `settings.systemPrompts.change:${operationScope}`,
  save: `settings.systemPrompts.save:${operationScope}`,
  reset: `settings.systemPrompts.reset:${operationScope}`,
  delete: `settings.systemPrompts.delete:${operationScope}`,
  editorSave: `settings.systemPrompts.editorSave:${operationScope}`
})

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
const operationPending = computed(() => props.feedback.status === 'pending')
const systemWriteBlocked = computed(() => operationPending.value || props.blocked)
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
const contextualFeedbackSurface = computed(
  () => systemPromptEditorOpen.value || deleteDialogOpen.value
)
const getFeedback = () => props.feedbackController.getSnapshot()

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

const beginOperation = (operationId: string, label: string): boolean => {
  if (props.blocked || getFeedback().status === 'pending') {
    return false
  }
  props.feedbackController.begin(operationId, label)
  return true
}

const failOperation = (operation: string, code: string, title: string, error: unknown) => {
  logFailure(operation, error)
  props.feedbackController.fail({ code, title })
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
  if (props.blocked || !currentSystemPrompt.value) return
  currentSystemPrompt.value.content = String(value)
  const feedback = getFeedback()
  if (feedback.status === 'error' && feedback.operationId === operationIds.save) {
    props.feedbackController.clearSettled()
  }
}

const handleSystemPromptChange = async (promptId: AcceptableValue) => {
  const id = String(promptId)
  if (
    currentPromptDirty.value ||
    props.blocked ||
    !selectableSystemPrompts.value.some((prompt) => prompt.id === id) ||
    !beginOperation(operationIds.change, t('common.saving'))
  ) {
    return
  }
  try {
    applySystemPromptState(await systemPromptStore.setDefaultSystemPromptId(id))
    props.feedbackController.succeed({
      code: 'settings.systemPrompts.changed',
      title: t('promptSetting.systemPromptChanged')
    })
    props.feedbackController.clearSettled()
  } catch (error) {
    failOperation(
      'change',
      'settings.systemPrompts.changeFailed',
      t('promptSetting.systemPromptChangeFailed'),
      error
    )
  }
}

const saveCurrentSystemPrompt = async () => {
  const prompt = currentSystemPrompt.value
  if (
    !prompt ||
    !currentPromptDirty.value ||
    !beginOperation(operationIds.save, t('common.saving'))
  ) {
    return
  }

  try {
    applySystemPromptState(
      await systemPromptStore.updateSystemPrompt(prompt.id, {
        content: prompt.content,
        updatedAt: Date.now()
      })
    )
    props.feedbackController.succeed({
      code: 'settings.systemPrompts.updated',
      title: t('promptSetting.systemPromptUpdated')
    })
  } catch (error) {
    failOperation(
      'save',
      'settings.systemPrompts.saveFailed',
      t('promptSetting.systemPromptSaveFailed'),
      error
    )
  }
}

const resetDefaultSystemPrompt = async () => {
  if (
    currentPromptDirty.value ||
    currentSystemPrompt.value?.id !== 'default' ||
    !beginOperation(operationIds.reset, t('common.saving'))
  ) {
    return
  }

  try {
    applySystemPromptState(await systemPromptStore.resetToDefaultPrompt())
    props.feedbackController.succeed({
      code: 'settings.systemPrompts.reset',
      title: t('promptSetting.resetToDefaultSuccess')
    })
  } catch (error) {
    failOperation(
      'reset',
      'settings.systemPrompts.resetFailed',
      t('promptSetting.resetToDefaultFailed'),
      error
    )
  }
}

const requestDeleteSystemPrompt = (promptId: string) => {
  if (
    props.blocked ||
    currentPromptDirty.value ||
    getFeedback().status === 'pending' ||
    !systemPrompts.value.some((prompt) => prompt.id === promptId)
  ) {
    return
  }
  if (getFeedback().status !== 'idle') {
    props.feedbackController.clearSettled()
  }
  pendingDeleteSystemPromptId.value = promptId
}

const handleDeleteDialogOpenChange = (open: boolean) => {
  if (open || getFeedback().status === 'pending') {
    return
  }
  pendingDeleteSystemPromptId.value = null
  if (getFeedback().status !== 'idle') {
    props.feedbackController.clearSettled()
  }
}

const deleteSystemPrompt = async () => {
  const prompt = pendingDeleteSystemPrompt.value
  if (!prompt || !beginOperation(operationIds.delete, t('common.saving'))) {
    return
  }

  try {
    applySystemPromptState(await systemPromptStore.deleteSystemPrompt(prompt.id))
    props.feedbackController.succeed({
      code: 'settings.systemPrompts.deleted',
      title: t('promptSetting.systemPromptDeleted')
    })
    props.feedbackController.clearSettled()
    pendingDeleteSystemPromptId.value = null
  } catch (error) {
    failOperation(
      'delete',
      'settings.systemPrompts.deleteFailed',
      t('promptSetting.systemPromptDeleteFailed'),
      error
    )
  }
}

const openCreatePrompt = () => {
  if (
    !loaded.value ||
    props.blocked ||
    currentPromptDirty.value ||
    getFeedback().status === 'pending'
  ) {
    return
  }
  if (getFeedback().status !== 'idle') {
    props.feedbackController.clearSettled()
  }
  editingSystemPrompt.value = null
  systemPromptEditorOpen.value = true
}

const handleEditorOpenChange = (open: boolean) => {
  if (!open && getFeedback().status === 'pending') {
    return
  }
  systemPromptEditorOpen.value = open
  if (!open) {
    editingSystemPrompt.value = null
    if (getFeedback().status !== 'idle') {
      props.feedbackController.clearSettled()
    }
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
  if (!beginOperation(operationIds.editorSave, t('common.saving'))) {
    return
  }
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
        failOperation(
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
    props.feedbackController.succeed({
      code: id ? 'settings.systemPrompts.updated' : 'settings.systemPrompts.added',
      title: id
        ? t('promptSetting.systemPromptUpdated')
        : t('promptSetting.systemPromptAddedAndSwitched')
    })
  } catch (error) {
    failOperation(
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
  const feedback = getFeedback()
  if (feedback.status === 'error' && feedback.operationId === operationIds.save) {
    props.feedbackController.clearSettled()
  }
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: operationIds.save,
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
const stopFeedbackSurfaceSync = watch(
  contextualFeedbackSurface,
  (active) => {
    emit('feedback-surface', active)
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
  stopFeedbackSurfaceSync()
  leaveGuardLease.release()
  emit('dirty-change', false)
  emit('feedback-surface', false)
})
</script>
