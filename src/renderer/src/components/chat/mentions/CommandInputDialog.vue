<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="max-h-[55vh] overflow-y-auto pr-1">
        <div class="space-y-3 py-2">
          <div v-for="field in fields" :key="field.name" class="space-y-1">
            <Label :for="field.name" class="text-sm font-medium">
              {{ field.label || field.name }}
              <span v-if="field.required" class="text-destructive">*</span>
            </Label>
            <Input
              :id="field.name"
              v-model="values[field.name]"
              :placeholder="field.placeholder || field.description || ''"
              :class="errors[field.name] ? 'border-destructive' : ''"
              @keydown.enter="onEnter(field.name)"
            />
            <p v-if="field.description" class="text-xs text-muted-foreground">
              {{ field.description }}
            </p>
            <p v-if="errors[field.name]" class="text-xs text-destructive">
              {{ errors[field.name] }}
            </p>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">Cancel</Button>
        <Button @click="submit">{{ confirmText || 'Confirm' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'

export interface CommandInputField {
  name: string
  label: string
  description?: string
  placeholder?: string
  required?: boolean
}

const props = defineProps<{
  open: boolean
  title: string
  description?: string
  confirmText?: string
  fields: CommandInputField[]
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [values: Record<string, string>]
}>()

const values = reactive<Record<string, string>>({})
const errors = reactive<Record<string, string>>({})

const resetForm = () => {
  Object.keys(values).forEach((key) => {
    delete values[key]
  })
  Object.keys(errors).forEach((key) => {
    delete errors[key]
  })

  for (const field of props.fields) {
    values[field.name] = ''
  }
}

watch(
  () => [props.open, props.fields],
  ([open]) => {
    if (open) {
      resetForm()
    }
  },
  { immediate: true }
)

const validate = () => {
  Object.keys(errors).forEach((key) => {
    delete errors[key]
  })

  for (const field of props.fields) {
    if (!field.required) continue
    if (!values[field.name]?.trim()) {
      errors[field.name] = 'This field is required.'
    }
  }

  return Object.keys(errors).length === 0
}

const submit = () => {
  if (!validate()) return
  emit('submit', { ...values })
}

const onEnter = (fieldName: string) => {
  const index = props.fields.findIndex((field) => field.name === fieldName)
  if (index === props.fields.length - 1) {
    submit()
  }
}
</script>
