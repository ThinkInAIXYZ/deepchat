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
        <div class="flex items-center justify-between w-full">
          <div class="text-xs text-muted-foreground">
            {{ form.content.length }} {{ t('promptSetting.characters') }}
          </div>
          <div class="flex items-center gap-3">
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t('common.cancel') }}
            </Button>
            <Button :disabled="!form.name || !form.content" @click="handleSave">
              <Icon icon="lucide:save" class="w-4 h-4 mr-1" />
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

const isEditing = computed(() => Boolean(form.id))

const resetForm = () => {
  form.id = ''
  form.name = ''
  form.content = ''
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetForm()
      return
    }

    if (props.prompt) {
      form.id = props.prompt.id
      form.name = props.prompt.name
      form.content = props.prompt.content
    } else {
      resetForm()
    }
  }
)

watch(
  () => props.prompt,
  (prompt) => {
    if (!props.open) return

    if (prompt) {
      form.id = prompt.id
      form.name = prompt.name
      form.content = prompt.content
    } else {
      resetForm()
    }
  }
)

const handleOpenChange = (value: boolean) => {
  emit('update:open', value)
}

const handleSave = () => {
  emit('save', {
    id: form.id,
    name: form.name,
    content: form.content
  })
}
</script>

<style scoped>
.window-no-drag-region {
  -webkit-app-region: no-drag;
}
</style>
