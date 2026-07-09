<template>
  <NodeViewWrapper
    class="my-2 rounded-lg border border-border bg-card p-3 shadow-sm"
    data-command-form
    as="div"
  >
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-sm font-medium text-foreground">
          <template v-if="mode === 'command'">/{{ commandName }}</template>
          <template v-else>{{ commandName }}</template>
        </div>
        <p v-if="description" class="text-xs text-muted-foreground truncate mt-0.5">
          {{ description }}
        </p>
      </div>
      <button
        type="button"
        class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        @click="handleCancel"
      >
        <Icon icon="lucide:x" class="h-3.5 w-3.5" />
      </button>
    </div>

    <div class="space-y-2">
      <div v-for="(field, index) in parsedFields" :key="field.name" class="space-y-1">
        <Label :for="field.name" class="text-xs font-medium text-muted-foreground">
          {{ field.label || field.name }}
          <span v-if="field.required" class="text-destructive">*</span>
        </Label>
        <Input
          :id="field.name"
          v-model="formValues[field.name]"
          :placeholder="field.placeholder || field.description || ''"
          class="h-8 text-xs"
          @keydown.enter.prevent.stop="handleFieldEnter(index, $event)"
        />
      </div>
    </div>

    <div class="mt-3 flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" class="h-7 rounded-full px-3 text-xs" @click="handleCancel">
        {{ t('common.cancel') }}
      </Button>
      <Button
        size="sm"
        class="h-7 rounded-full px-3 text-xs"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        {{ confirmText || t('common.confirm') }}
      </Button>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, inject, reactive } from 'vue'
import { Icon } from '@iconify/vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { useI18n } from 'vue-i18n'
import { INPUT_NODE_ACTIONS, type InputNodeActions } from './symbols'

const props = defineProps<NodeViewProps>()
const actions = inject<InputNodeActions>(INPUT_NODE_ACTIONS)
const { t } = useI18n()

const mode = computed(() => props.node.attrs.mode as string)
const commandName = computed(() => props.node.attrs.commandName as string)
const description = computed(() => props.node.attrs.description as string)
const confirmText = computed(() => props.node.attrs.confirmText as string)

const parsedFields = computed(() => {
  try {
    return JSON.parse(props.node.attrs.fields as string) as Array<{
      name: string
      label: string
      description?: string
      placeholder?: string
      required?: boolean
    }>
  } catch {
    return []
  }
})

const formValues = reactive<Record<string, string>>({})

const canSubmit = computed(() => {
  return parsedFields.value.every((field) => {
    if (field.required) {
      return !!formValues[field.name]?.trim()
    }
    return true
  })
})

function handleFieldEnter(index: number, event: KeyboardEvent) {
  if (parsedFields.value.length === 1 || index === parsedFields.value.length - 1) {
    handleSubmit()
    return
  }

  const form = (event.currentTarget as HTMLInputElement | null)?.closest('[data-command-form]')
  const nextInput = form?.querySelectorAll<HTMLInputElement>('input')[index + 1]
  nextInput?.focus()
}

function handleSubmit() {
  if (!canSubmit.value) return
  actions?.prepareCommandFormSubmit()
  props.deleteNode()
  if (actions?.submitCommandForm) {
    actions.submitCommandForm({ ...formValues })
  }
}

function handleCancel() {
  props.deleteNode()
  if (actions?.cancelCommandForm) {
    actions.cancelCommandForm()
  }
}
</script>
