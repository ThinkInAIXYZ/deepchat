<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="right"
      class="w-[75vw]! max-w-[95vw]! h-screen flex flex-col p-0 bg-background window-no-drag-region"
    >
      <SheetHeader class="px-6 py-4 border-b bg-card/50 shrink-0">
        <SheetTitle class="flex items-center gap-2">
          <Icon
            :icon="isEditing ? 'lucide:edit-3' : 'lucide:plus-circle'"
            class="w-5 h-5 text-primary"
          />
          <span>{{ isEditing ? t('promptSetting.editTitle') : t('promptSetting.addTitle') }}</span>
        </SheetTitle>
        <SheetDescription>
          {{ isEditing ? t('promptSetting.editDescription') : t('promptSetting.addDescription') }}
        </SheetDescription>
      </SheetHeader>

      <ScrollArea class="flex-1 h-0 px-6">
        <div class="py-6 space-y-6">
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
              <Button variant="outline" size="sm" @click="addParameter">
                <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
                {{ t('promptSetting.addParameter') }}
              </Button>
            </div>

            <div v-if="form.parameters.length" class="space-y-4">
              <div
                v-for="(param, index) in form.parameters"
                :key="index"
                class="relative p-4 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  class="absolute top-3 right-3 h-7 w-7 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all duration-200"
                  :title="t('common.delete')"
                  @click="removeParameter(index)"
                >
                  <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
                </Button>

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
                class="group border-2 border-dashed border-muted rounded-lg p-4 hover:border-primary/50 hover:bg-muted/20 transition-all cursor-pointer"
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
                    <Button
                      variant="ghost"
                      size="icon"
                      class="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 bg-background/80 border border-border/50 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-all duration-200"
                      :title="t('common.delete')"
                      @click="removeFile(index)"
                    >
                      <Icon icon="lucide:trash-2" class="w-3 h-3" />
                    </Button>

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
      </ScrollArea>

      <SheetFooter class="px-6 py-4 border-t bg-card/50">
        <div class="flex items-center justify-between w-full">
          <div class="text-xs text-muted-foreground">
            {{ form.content.length }} {{ t('promptSetting.characters') }}
          </div>
          <div class="flex items-center gap-3">
            <Button variant="outline" @click="emit('update:open', false)">{{
              t('common.cancel')
            }}</Button>
            <Button :disabled="!form.name || !form.content" @click="submit">
              <Icon :icon="isEditing ? 'lucide:save' : 'lucide:plus'" class="w-4 h-4 mr-1" />
              {{ t('common.confirm') }}
            </Button>
          </div>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import { MessageFile } from '@shared/chat'
import { getMimeTypeIcon } from '@/lib/utils'
import { FileItem } from '@shared/presenter'

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
const { toast } = useToast()
const filePresenter = usePresenter('filePresenter')

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

const isEditing = computed(() => Boolean(form.id))

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
}

const applyPrompt = (prompt: PromptForm | null) => {
  if (!prompt) {
    resetForm()
    return
  }

  form.id = prompt.id
  form.name = prompt.name
  form.description = prompt.description
  form.content = prompt.content
  form.parameters = prompt.parameters?.map((param) => ({ ...param })) || []
  form.files = prompt.files ? [...prompt.files] : []
  form.enabled = prompt.enabled ?? true
  form.source = prompt.source ?? 'local'
  form.createdAt = prompt.createdAt
  form.updatedAt = prompt.updatedAt
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetForm()
      return
    }
    applyPrompt(props.prompt)
  }
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
  if (!value) {
    resetForm()
  }
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

const uploadFile = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.txt,.md,.csv,.json,.xml,.pdf,.doc,.docx'
  input.onchange = async (event) => {
    const files = (event.target as HTMLInputElement).files
    if (!files) return

    try {
      await Promise.all(
        Array.from(files).map(async (file) => {
          const path = window.api.getPathForFile(file)
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)

          const fileItem: FileItem = {
            id: nanoid(8),
            name: fileInfo.name,
            type: fileInfo.mimeType,
            size: fileInfo.metadata.fileSize,
            path: fileInfo.path,
            description: fileInfo.metadata.fileDescription,
            content: fileInfo.content,
            createdAt: Date.now()
          }

          form.files.push(fileItem)
        })
      )

      toast({
        title: t('promptSetting.uploadSuccess'),
        description: t('promptSetting.uploadedCount', { count: files.length }),
        variant: 'default'
      })
    } catch (error) {
      console.error('Failed to upload prompt attachments:', error)
      toast({
        title: t('promptSetting.uploadFailed'),
        variant: 'destructive'
      })
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
  emit('submit', {
    ...form,
    parameters: [...form.parameters],
    files: [...form.files]
  })
}
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
