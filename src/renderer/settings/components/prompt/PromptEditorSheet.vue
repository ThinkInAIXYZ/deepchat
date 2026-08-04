<template>
  <DcSheetPanel
    :open="open"
    :title="isEditing ? t('promptSetting.editTitle') : t('promptSetting.addTitle')"
    :description="
      isEditing ? t('promptSetting.editDescription') : t('promptSetting.addDescription')
    "
    :icon="isEditing ? 'lucide:edit-3' : 'lucide:plus-circle'"
    @update:open="handleOpenChange"
  >
    <fieldset :disabled="formDisabled" class="contents">
      <div class="space-y-6 px-5 py-5">
        <div class="space-y-4">
          <div class="flex items-center gap-2 pb-2 border-b border-border">
            <Label class="text-sm font-medium text-muted-foreground">
              {{ t('promptSetting.basicInfo') }}
            </Label>
          </div>

          <div class="space-y-4">
            <div>
              <Label class="text-sm font-medium">{{ t('promptSetting.name') }}</Label>
              <Input
                v-model="form.name"
                :placeholder="t('promptSetting.namePlaceholder')"
                class="mt-2"
              />
            </div>
            <div>
              <Label class="text-sm font-medium">{{ t('promptSetting.description') }}</Label>
              <Input
                v-model="form.description"
                :placeholder="t('promptSetting.descriptionPlaceholder')"
                class="mt-2"
              />
            </div>
          </div>

          <div class="flex items-center space-x-2 pt-2">
            <Checkbox
              id="prompt-enabled"
              :checked="form.enabled"
              @update:checked="(value) => (form.enabled = value === true)"
            />
            <Label for="prompt-enabled" class="text-sm">{{
              t('promptSetting.enablePrompt')
            }}</Label>
          </div>
        </div>

        <div class="space-y-4">
          <div class="flex items-center gap-2 pb-2 border-b border-border">
            <Icon icon="lucide:file-text" class="w-4 h-4 text-primary" />
            <Label class="text-sm font-medium text-muted-foreground">
              {{ t('promptSetting.promptContent') }}
            </Label>
          </div>

          <Textarea
            v-model="form.content"
            class="w-full min-h-48 font-mono resize-y"
            :placeholder="t('promptSetting.contentPlaceholder')"
          />
          <p class="text-xs text-muted-foreground mt-2">
            {{ t('promptSetting.contentTip', { openBrace: '{', closeBrace: '}' }) }}
          </p>
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between pb-2 border-b border-border">
            <div class="flex items-center gap-2">
              <Icon icon="lucide:settings" class="w-4 h-4 text-primary" />
              <Label class="text-sm font-medium text-muted-foreground">
                {{ t('promptSetting.parameters') }}
              </Label>
            </div>
            <DcButton variant="outline" size="sm" icon="lucide:plus" @click="addParameter">
              {{ t('promptSetting.addParameter') }}
            </DcButton>
          </div>

          <div v-if="form.parameters.length" class="space-y-4">
            <div
              v-for="(param, index) in form.parameters"
              :key="index"
              class="relative p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <DcButton
                icon="lucide:trash-2"
                size="icon-sm"
                :label="t('common.delete')"
                :tooltip="t('common.delete')"
                class="absolute top-3 right-3 h-7 w-7 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                @click="removeParameter(index)"
              />

              <div class="space-y-4 pr-12">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div class="md:col-span-2">
                    <Label class="text-sm text-muted-foreground">
                      {{ t('promptSetting.parameterName') }}
                    </Label>
                    <Input
                      v-model="param.name"
                      :placeholder="t('promptSetting.parameterNamePlaceholder')"
                      class="mt-2"
                    />
                  </div>
                  <div class="flex items-center gap-2">
                    <Checkbox
                      :id="`parameter-required-${index}`"
                      :checked="param.required"
                      @update:checked="(value) => (param.required = value === true)"
                    />
                    <Label :for="`parameter-required-${index}`" class="text-sm whitespace-nowrap">
                      {{ t('promptSetting.parameterRequired') }}
                    </Label>
                  </div>
                </div>

                <div>
                  <Label class="text-sm text-muted-foreground">
                    {{ t('promptSetting.parameterDescription') }}
                  </Label>
                  <Input
                    v-model="param.description"
                    :placeholder="t('promptSetting.parameterDescriptionPlaceholder')"
                    class="mt-2"
                  />
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-muted-foreground">
            {{ t('promptSetting.noParameters') }}
          </div>
        </div>

        <div class="space-y-4">
          <div class="flex items-center gap-2 pb-2 border-b border-border">
            <Icon icon="lucide:paperclip" class="w-4 h-4 text-primary" />
            <Label class="text-sm font-medium text-muted-foreground">
              {{ t('promptSetting.fileManagement') }}
            </Label>
          </div>

          <div class="space-y-4">
            <div
              class="group border-2 border-dashed border-muted rounded-lg p-4 hover:border-primary/50 hover:bg-muted/20 transition-all"
              :class="{ 'pointer-events-none opacity-60': formDisabled }"
              :aria-disabled="formDisabled"
              @click="uploadFile"
            >
              <div class="flex items-center gap-3">
                <div
                  class="p-2 bg-primary/10 rounded-lg shrink-0 group-hover:bg-primary/20 transition-colors"
                >
                  <Icon icon="lucide:upload" class="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p class="text-sm font-medium">{{ t('promptSetting.uploadFromDevice') }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('promptSetting.uploadFromDeviceDesc') }}
                  </p>
                </div>
              </div>
            </div>

            <div v-if="form.files.length" class="space-y-3">
              <Label class="text-sm text-muted-foreground">{{
                t('promptSetting.uploadedFiles')
              }}</Label>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div
                  v-for="(file, index) in form.files"
                  :key="file.id"
                  class="relative p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors group"
                >
                  <DcButton
                    icon="lucide:trash-2"
                    size="icon-xs"
                    :label="t('common.delete')"
                    :tooltip="t('common.delete')"
                    class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                    @click="removeFile(index)"
                  />

                  <div class="pr-8">
                    <div class="flex items-center gap-2 mb-2">
                      <div class="p-1.5 bg-primary/10 rounded">
                        <Icon :icon="getMimeTypeIcon(file.type)" class="w-4 h-4 text-primary" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium truncate" :title="file.name">
                          {{ file.name }}
                        </p>
                      </div>
                    </div>

                    <div class="flex items-center justify-between text-xs text-muted-foreground">
                      <span
                        class="px-2 py-0.5 bg-muted rounded truncate text-ellipsis whitespace-nowrap flex-1"
                      >
                        {{ file.type || 'unknown' }}
                      </span>
                      <span class="shrink-0">{{ formatFileSize(file.size) }}</span>
                    </div>

                    <p
                      v-if="file.description"
                      class="text-xs text-muted-foreground mt-2 line-clamp-2"
                    >
                      {{ file.description }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="text-center text-muted-foreground py-12 border-2 border-dashed border-muted rounded-lg bg-muted/20"
            >
              <Icon icon="lucide:folder-open" class="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p class="text-sm">{{ t('promptSetting.noFiles') }}</p>
              <p class="text-xs text-muted-foreground/70 mt-1">
                {{ t('promptSetting.noFilesUploadDesc') }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </fieldset>
    <template #footer>
      <div class="flex w-full items-center gap-3">
        <div class="text-xs text-muted-foreground">
          {{ form.content.length }} {{ t('promptSetting.characters') }}
        </div>
        <DcFormActions
          class="ml-auto"
          :submit-status="submitStatus"
          :submit-disabled="formDisabled || !form.name || !form.content"
          :cancel-disabled="formDisabled"
          :submit-icon="isEditing ? 'lucide:save' : 'lucide:plus'"
          @cancel="requestClose"
          @submit="submitWithStatus"
        />
      </div>
    </template>
  </DcSheetPanel>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { DcButton } from '@dc-ui/components/button'
import { DcSheetPanel } from '@dc-ui/components/sheet-panel'
import { useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Textarea } from '@shadcn/components/ui/textarea'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { createFileClient } from '@api/FileClient'
import { MessageFile } from '@shared/chat'
import { getMimeTypeIcon } from '@/lib/utils'
import type { FileItem } from '@shared/types/file'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

interface PromptParameter {
  name: string
  description: string
  required: boolean
}

interface PromptForm {
  id: string
  name: string
  description: string
  content: string
  parameters: PromptParameter[]
  files: FileItem[]
  enabled: boolean
  source: 'local' | 'imported' | 'builtin'
  createdAt?: number
  updatedAt?: number
}

const props = defineProps<{
  open: boolean
  prompt: PromptForm | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', value: PromptForm): void
}>()

const { t } = useI18n()
const fileClient = createFileClient()
const editorGuardId = `settings.prompts.editor:${nanoid(8)}`
let attachmentGeneration = 0

const form = reactive<PromptForm>({
  id: '',
  name: '',
  description: '',
  content: '',
  parameters: [],
  files: [],
  enabled: true,
  source: 'local',
  createdAt: undefined,
  updatedAt: undefined
})
const baselineForm = shallowRef<PromptForm | null>(null)
const attachmentBusy = ref(false)

const isEditing = computed(() => Boolean(form.id))
const formDisabled = computed(() => attachmentBusy.value)

const cloneForm = (): PromptForm => ({
  ...form,
  parameters: form.parameters.map((parameter) => ({ ...parameter })),
  files: form.files.map((file) => ({ ...file }))
})

const captureBaseline = () => {
  baselineForm.value = cloneForm()
}

const draftDirty = computed(() => {
  const baseline = baselineForm.value
  if (!props.open || !baseline) return false
  if (
    form.id !== baseline.id ||
    form.name !== baseline.name ||
    form.description !== baseline.description ||
    form.content !== baseline.content ||
    form.enabled !== baseline.enabled ||
    form.source !== baseline.source ||
    form.createdAt !== baseline.createdAt ||
    form.updatedAt !== baseline.updatedAt ||
    form.parameters.length !== baseline.parameters.length ||
    form.files.length !== baseline.files.length
  ) {
    return true
  }
  if (
    form.parameters.some((parameter, index) => {
      const original = baseline.parameters[index]
      return (
        parameter.name !== original.name ||
        parameter.description !== original.description ||
        parameter.required !== original.required
      )
    })
  ) {
    return true
  }
  return form.files.some((file, index) => {
    const original = baseline.files[index]
    return (
      file.id !== original.id ||
      file.name !== original.name ||
      file.type !== original.type ||
      file.size !== original.size ||
      file.path !== original.path ||
      file.description !== original.description ||
      file.content !== original.content ||
      file.createdAt !== original.createdAt
    )
  })
})

const resetForm = () => {
  form.id = ''
  form.name = ''
  form.description = ''
  form.content = ''
  form.parameters = []
  form.files = []
  form.enabled = true
  form.source = 'local'
  form.createdAt = undefined
  form.updatedAt = undefined
  captureBaseline()
}

const resetAttachmentFeedback = () => {
  attachmentGeneration += 1
  attachmentBusy.value = false
}

const applyPrompt = (prompt: PromptForm | null) => {
  resetAttachmentFeedback()
  if (!prompt) {
    resetForm()
    return
  }

  form.id = prompt.id
  form.name = prompt.name
  form.description = prompt.description
  form.content = prompt.content
  form.parameters = prompt.parameters?.map((param) => ({ ...param })) || []
  form.files = prompt.files?.map((file) => ({ ...file })) || []
  form.enabled = prompt.enabled ?? true
  form.source = prompt.source ?? 'local'
  form.createdAt = prompt.createdAt
  form.updatedAt = prompt.updatedAt
  captureBaseline()
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetAttachmentFeedback()
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
  if (!value && formDisabled.value) {
    return
  }
  emit('update:open', value)
  if (!value) {
    resetForm()
  }
}

const requestClose = () => {
  if (formDisabled.value) {
    return
  }
  resetForm()
  emit('update:open', false)
}

const addParameter = () => {
  form.parameters.push({
    name: '',
    description: '',
    required: true
  })
}

const removeParameter = (index: number) => {
  form.parameters.splice(index, 1)
}

const preparePromptFile = async (file: File): Promise<FileItem> => {
  const path = fileClient.getPathForFile(file)
  const mimeType = await fileClient.getMimeType(path)
  const preparedFile = await fileClient.prepareFile(path, mimeType)
  const metadata = preparedFile.metadata as Partial<MessageFile['metadata']> | undefined
  const fileInfo: MessageFile = {
    ...preparedFile,
    content: preparedFile.content ?? '',
    mimeType: preparedFile.mimeType ?? mimeType ?? file.type,
    token: preparedFile.token ?? 0,
    metadata: {
      fileName: typeof metadata?.fileName === 'string' ? metadata.fileName : preparedFile.name,
      fileSize:
        typeof metadata?.fileSize === 'number'
          ? metadata.fileSize
          : (preparedFile.size ?? file.size),
      fileDescription:
        typeof metadata?.fileDescription === 'string'
          ? metadata.fileDescription
          : (preparedFile.type ?? file.type),
      fileCreated:
        metadata?.fileCreated instanceof Date ? metadata.fileCreated : new Date(file.lastModified),
      fileModified:
        metadata?.fileModified instanceof Date ? metadata.fileModified : new Date(file.lastModified)
    }
  }

  return {
    id: nanoid(8),
    name: fileInfo.name,
    type: fileInfo.mimeType,
    size: fileInfo.metadata.fileSize,
    path: fileInfo.path,
    description: fileInfo.metadata.fileDescription,
    content: fileInfo.content,
    createdAt: Date.now()
  }
}

const uploadFile = () => {
  if (formDisabled.value || !props.open) {
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.txt,.md,.csv,.json,.xml,.pdf,.doc,.docx'
  input.onchange = async (event) => {
    const files = (event.target as HTMLInputElement).files
    if (!files || files.length === 0 || formDisabled.value || !props.open) return

    const selectedFiles = Array.from(files)
    const generation = ++attachmentGeneration
    attachmentBusy.value = true
    try {
      const preparedFiles = await Promise.all(selectedFiles.map(preparePromptFile))
      if (generation !== attachmentGeneration || !props.open) {
        return
      }
      form.files.push(...preparedFiles)
      notifyRenderer({
        kind: 'success',
        code: 'settings.prompts.attachmentsPrepared',
        title: t('promptSetting.uploadSuccess'),
        description: t('promptSetting.uploadedCount', { count: selectedFiles.length })
      })
    } catch (error) {
      if (generation !== attachmentGeneration || !props.open) {
        return
      }
      console.error('[PromptEditorSheet] Failed to prepare attachments', error)
      notifyRenderer({
        kind: 'error',
        code: 'settings.prompts.attachmentsFailed',
        title: t('promptSetting.uploadFailed')
      })
    } finally {
      if (generation === attachmentGeneration) {
        attachmentBusy.value = false
      }
    }
  }

  input.click()
}

const removeFile = (index: number) => {
  form.files.splice(index, 1)
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

const submit = () => {
  if (formDisabled.value || !form.name || !form.content) {
    return
  }
  resetAttachmentFeedback()
  emit('submit', {
    ...form,
    parameters: form.parameters.map((parameter) => ({ ...parameter })),
    files: form.files.map((file) => ({ ...file }))
  })
}

const { status: submitStatus, run: runSubmit } = useDcFormSubmit()
const submitWithStatus = () => void runSubmit(async () => submit())

const leaveGuardLease = settingsLeaveGuard.register({
  id: editorGuardId,
  onDiscard: requestClose
})
const stopLeaveRiskSync = watch(
  [draftDirty, attachmentBusy],
  ([dirty, preparing]) => {
    leaveGuardLease.setRisk(preparing ? 'busy' : dirty ? 'dirty' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onBeforeUnmount(() => {
  resetAttachmentFeedback()
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
