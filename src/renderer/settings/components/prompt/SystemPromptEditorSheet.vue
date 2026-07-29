<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="right"
      class="w-[60vw]! max-w-[90vw]! h-screen flex flex-col p-0 bg-background window-no-drag-region"
    >
      <SheetHeader class="px-6 py-4 border-b bg-card/50 shrink-0">
        <SheetTitle class="flex items-center gap-2">
          <Icon icon="lucide:settings" class="w-5 h-5 text-primary" />
          <span>
            {{
              isEditing ? t('promptSetting.editSystemPrompt') : t('promptSetting.addSystemPrompt')
            }}
          </span>
        </SheetTitle>
        <SheetDescription>
          {{
            isEditing
              ? t('promptSetting.editSystemPromptDesc')
              : t('promptSetting.addSystemPromptDesc')
          }}
        </SheetDescription>
      </SheetHeader>

      <fieldset :disabled="pending" class="contents">
        <ScrollArea class="flex-1 overflow-hidden">
          <div class="px-6 py-4 space-y-4">
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
        </ScrollArea>

        <SheetFooter class="px-6 py-4 border-t bg-card/50">
          <InlineOperationFeedback class="min-w-0" :snapshot="feedback" />
          <div class="text-xs text-muted-foreground">
            {{ form.content.length }} {{ t('promptSetting.characters') }}
          </div>
          <div class="flex items-center gap-3">
            <Button variant="outline" :disabled="pending" @click="requestClose">
              {{ t('common.cancel') }}
            </Button>
            <Button :disabled="pending || !form.name || !form.content" @click="handleSave">
              <Icon icon="lucide:save" class="w-4 h-4 mr-1" />
              {{ t('common.confirm') }}
            </Button>
          </div>
        </SheetFooter>
      </fieldset>
    </SheetContent>
  </Sheet>
</template>

<script setup lang="ts">
import { nanoid } from 'nanoid'
import { computed, onBeforeUnmount, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Textarea } from '@shadcn/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import InlineOperationFeedback from '@renderer-notifications/InlineOperationFeedback.vue'
import type { SurfaceFeedbackSnapshot } from '@renderer-notifications/surfaceFeedbackController'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

interface SystemPromptForm {
  id: string
  name: string
  content: string
}

const props = defineProps<{
  open: boolean
  prompt: SystemPromptForm | null
  pending: boolean
  feedback: SurfaceFeedbackSnapshot
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
  if (!value && props.pending) {
    return
  }
  emit('update:open', value)
}

const requestClose = () => {
  if (props.pending) {
    return
  }
  resetForm()
  emit('update:open', false)
}

const handleSave = () => {
  if (props.pending || !form.name || !form.content) {
    return
  }
  emit('save', {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    content: form.content
  })
}

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
