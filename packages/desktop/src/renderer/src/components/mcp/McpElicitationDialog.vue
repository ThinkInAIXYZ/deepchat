<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Spinner } from '@shadcn/components/ui/spinner'
import { useMcpElicitationStore } from '@/stores/mcpElicitation'

const store = useMcpElicitationStore()
const { t } = useI18n()

const updateTextValue = (name: string, event: Event) => {
  store.setValue(name, (event.target as HTMLInputElement).value)
}

const updateBooleanValue = (name: string, event: Event) => {
  store.setValue(name, (event.target as HTMLInputElement).checked)
}

const updateMultiValue = (name: string, event: Event) => {
  const select = event.target as HTMLSelectElement
  store.setValue(
    name,
    Array.from(select.selectedOptions, (option) => option.value)
  )
}

const isMultiValueSelected = (name: string, value: string): boolean => {
  const selected = store.values[name]
  return Array.isArray(selected) && selected.includes(value)
}

const onDialogToggle = (open: boolean) => {
  if (!open) {
    void store.cancel()
  }
}
</script>

<template>
  <Dialog :open="store.isOpen" @update:open="onDialogToggle">
    <DialogContent class="max-w-xl">
      <DialogHeader>
        <DialogTitle>
          {{
            t('mcp.elicitation.title', {
              server: store.request?.serverName || t('mcp.sampling.unknownServer')
            })
          }}
        </DialogTitle>
        <DialogDescription class="whitespace-pre-wrap">
          {{ store.request?.message }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="store.request?.mode === 'form'" class="max-h-[55vh] space-y-4 overflow-auto py-1">
        <div v-for="field in store.fields" :key="field.name" class="space-y-1.5">
          <Label :for="`mcp-elicit-${field.name}`">
            {{ field.title }}
            <span v-if="field.required" aria-hidden="true">*</span>
          </Label>
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <input
            v-if="field.type === 'boolean'"
            :id="`mcp-elicit-${field.name}`"
            type="checkbox"
            class="size-4"
            :checked="Boolean(store.values[field.name])"
            @change="updateBooleanValue(field.name, $event)"
          />
          <select
            v-else-if="field.type === 'single-select'"
            :id="`mcp-elicit-${field.name}`"
            class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            :value="String(store.values[field.name] ?? '')"
            @change="updateTextValue(field.name, $event)"
          >
            <option value="">{{ t('mcp.elicitation.selectValue') }}</option>
            <option v-for="option in field.options" :key="option.value" :value="option.value">
              {{ option.title }}
            </option>
          </select>
          <select
            v-else-if="field.type === 'multi-select'"
            :id="`mcp-elicit-${field.name}`"
            multiple
            class="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            @change="updateMultiValue(field.name, $event)"
          >
            <option
              v-for="option in field.options"
              :key="option.value"
              :value="option.value"
              :selected="isMultiValueSelected(field.name, option.value)"
            >
              {{ option.title }}
            </option>
          </select>
          <Input
            v-else
            :id="`mcp-elicit-${field.name}`"
            :type="
              field.type === 'number' || field.type === 'integer'
                ? 'number'
                : field.format === 'email'
                  ? 'email'
                  : field.format === 'date'
                    ? 'date'
                    : field.format === 'uri'
                      ? 'url'
                      : 'text'
            "
            :step="field.type === 'integer' ? '1' : undefined"
            :min="field.minimum"
            :max="field.maximum"
            :minlength="field.minLength"
            :maxlength="field.maxLength"
            :value="String(store.values[field.name] ?? '')"
            @input="updateTextValue(field.name, $event)"
          />
          <p v-if="store.errors[field.name]" class="text-xs text-destructive">
            {{ t(`mcp.elicitation.error.${store.errors[field.name]}`) }}
          </p>
        </div>
        <p v-if="store.fields.length === 0" class="text-sm text-muted-foreground">
          {{ t('mcp.elicitation.noFields') }}
        </p>
      </div>

      <div v-else-if="store.request?.url" class="space-y-3">
        <div class="break-all rounded-md border bg-muted/40 p-3 text-xs">
          {{ store.request.url }}
        </div>
        <DcButton variant="outline" @click="store.openRequestedUrl">
          {{ t('mcp.elicitation.openLink') }}
        </DcButton>
      </div>

      <DialogFooter>
        <DcButton variant="ghost" :disabled="store.isSubmitting" @click="store.decline">
          {{ t('mcp.elicitation.decline') }}
        </DcButton>
        <DcButton :disabled="store.isSubmitting" @click="store.accept">
          <Spinner v-if="store.isSubmitting" data-icon="inline-start" />
          {{ t('mcp.elicitation.accept') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
