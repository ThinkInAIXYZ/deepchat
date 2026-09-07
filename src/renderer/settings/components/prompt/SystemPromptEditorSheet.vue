<template>
  <DcSheetPanel
    :open="open"
    :title="isEditing ? t('promptSetting.editSystemPrompt') : t('promptSetting.addSystemPrompt')"
    :description="
      isEditing ? t('promptSetting.editSystemPromptDesc') : t('promptSetting.addSystemPromptDesc')
    "
    icon="lucide:settings"
    width-class="w-full sm:w-[min(40rem,92vw)]"
    @update:open="handleOpenChange"
  >
    <fieldset class="contents">
      <div class="space-y-4 px-5 py-4">
        <div class="space-y-2">
          <Label for="system-prompt-name" class="text-sm font-medium">
            {{ t('promptSetting.name') }}
          </Label>
          <Input
            id="system-prompt-name"
            v-model="form.name"
            :placeholder="t('promptSetting.namePlaceholder')"
          />
        </div>

        <div class="space-y-2">
          <Label for="system-prompt-content" class="text-sm font-medium">
            {{ t('promptSetting.promptContent') }}
          </Label>
          <Textarea
            id="system-prompt-content"
            v-model="form.content"
            class="w-full h-64"
            :placeholder="t('promptSetting.contentPlaceholder')"
          />
        </div>
      </div>
    </fieldset>

    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-3">
        <div class="text-xs text-muted-foreground">
          {{ form.content.length }} {{ t('promptSetting.characters') }}
        </div>
        <DcFormActions
          class="ml-auto"
          :submit-status="submitStatus"
          :submit-disabled="!form.name || !form.content"
          :submit-icon="'lucide:save'"
          @cancel="requestClose"
          @submit="saveWithStatus"
        />
      </div>
    </template>
  </DcSheetPanel>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { computed, onBeforeUnmount, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcSheetPanel } from '@dc-ui/components/sheet-panel'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

interface SystemPromptForm {
  id: string
  name: string
  content: string
}

const props = defineProps<{
  open: boolean
  prompt: SystemPromptForm | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (
    e: 'save',
    value: {
      id?: string
      name: string
      content: string
    }
  ): void
}>()

const { t } = useI18n()

const form = reactive<SystemPromptForm>({
  id: '',
  name: '',
  content: ''
})
const baselineForm = shallowRef<SystemPromptForm | null>(null)

const isEditing = computed(() => Boolean(form.id))
const draftDirty = computed(
  () =>
    props.open &&
    baselineForm.value !== null &&
    (form.id !== baselineForm.value.id ||
      form.name !== baselineForm.value.name ||
      form.content !== baselineForm.value.content)
)

const captureBaseline = () => {
  baselineForm.value = { ...form }
}

const resetForm = () => {
  form.id = ''
  form.name = ''
  form.content = ''
  captureBaseline()
}

const applyPrompt = (prompt: SystemPromptForm | null) => {
  if (!prompt) {
    resetForm()
    return
  }
  form.id = prompt.id
  form.name = prompt.name
  form.content = prompt.content
  captureBaseline()
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetForm()
      return
    }

    applyPrompt(props.prompt)
  },
  { immediate: true }
)

watch(
  () => props.prompt,
  (prompt) => {
    if (!props.open) return
    applyPrompt(prompt)
  }
)

const handleOpenChange = (value: boolean) => {
  emit('update:open', value)
}

const requestClose = () => {
  resetForm()
  emit('update:open', false)
}

const handleSave = () => {
  if (!form.name || !form.content) {
    return
  }
  emit('save', {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    content: form.content
  })
}

const { status: submitStatus, run: runSubmit } = useDcFormSubmit()
const saveWithStatus = () => void runSubmit(async () => handleSave())

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.systemPrompts.editor:${nanoid(8)}`,
  onDiscard: requestClose
})
const stopLeaveRiskSync = watch(
  draftDirty,
  (dirty) => {
    leaveGuardLease.setRisk(dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
}
</style>
