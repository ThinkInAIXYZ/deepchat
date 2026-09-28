<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { createBrowserClient } from '@api/BrowserClient'
import type { AcpElicitationField, AcpElicitationView } from '@shared/types/acp-elicitation'
import { useAcpExtensionsStore } from '@/stores/acpExtensions'

const props = defineProps<{ request: AcpElicitationView }>()
const store = useAcpExtensionsStore()
const { t } = useI18n()
const formId = useId()
const requestHost = computed(() => (props.request.url ? new URL(props.request.url).host : ''))
const values = computed(() => store.values[props.request.requestId] ?? {})
const busy = computed(() => store.busy.has(props.request.requestId))
const fields = computed(() => {
  const result: AcpElicitationField[] = []
  for (const field of props.request.fields) {
    if (field.noteFor || field.customAnswerFor) continue
    result.push(
      field,
      ...props.request.fields.filter(
        (entry) => entry.customAnswerFor === field.name || entry.noteFor === field.name
      )
    )
  }
  return result
})
const replaced = (field: AcpElicitationField) =>
  props.request.fields.some(
    (entry) =>
      entry.customAnswerFor === field.name &&
      typeof values.value[entry.name] === 'string' &&
      String(values.value[entry.name]).trim()
  )
function input(field: AcpElicitationField, event: Event) {
  const target = event.target as HTMLInputElement
  const value =
    field.type === 'boolean'
      ? target.checked
      : field.type === 'number' || field.type === 'integer'
        ? target.value === ''
          ? undefined
          : Number(target.value)
        : target.value || undefined
  store.setValue(props.request.requestId, field.name, value)
}
function select(field: AcpElicitationField, value: string, event: Event) {
  if (field.type === 'single-select') {
    store.setValue(props.request.requestId, field.name, value)
    return
  }
  const selected = new Set(
    Array.isArray(values.value[field.name]) ? (values.value[field.name] as string[]) : []
  )
  if ((event.target as HTMLInputElement).checked) selected.add(value)
  else selected.delete(value)
  store.setValue(props.request.requestId, field.name, [...selected])
}
async function openUrl() {
  if (!props.request.url) return
  try {
    await createBrowserClient().openExternal(props.request.url)
  } catch {
    store.errors[props.request.requestId] = true
  }
}
</script>

<template>
  <form class="space-y-4 p-3" @submit.prevent="store.respond(request.requestId, 'accept')">
    <p class="whitespace-pre-wrap text-sm">{{ request.message }}</p>
    <p v-if="request.expiresAt" class="text-xs text-muted-foreground">
      {{
        t('chat.acpExtensions.expires', { time: new Date(request.expiresAt).toLocaleTimeString() })
      }}
    </p>
    <template v-if="request.status === 'pending'">
      <div v-if="request.mode === 'form'" class="max-h-[45vh] space-y-4 overflow-auto">
        <fieldset
          v-for="(field, fieldIndex) in fields"
          :key="field.name"
          :disabled="busy || replaced(field)"
          :class="['space-y-2', field.noteFor || field.customAnswerFor ? 'ml-4' : '']"
        >
          <legend class="text-sm font-medium">
            {{ field.title }}<span v-if="field.required" aria-hidden="true"> *</span>
          </legend>
          <p v-if="field.description" class="whitespace-pre-wrap text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <pre v-if="field.preview" class="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{{
            field.preview
          }}</pre>
          <template v-if="field.options">
            <label
              v-for="(option, optionIndex) in field.options"
              :key="option.value"
              class="flex items-start gap-2 text-sm"
            >
              <input
                :id="`${formId}-${fieldIndex}-${optionIndex}`"
                :name="`${formId}-${fieldIndex}`"
                :type="field.type === 'multi-select' ? 'checkbox' : 'radio'"
                :value="option.value"
                :required="field.required && field.type === 'single-select'"
                :checked="
                  field.type === 'multi-select'
                    ? Array.isArray(values[field.name]) &&
                      (values[field.name] as string[]).includes(option.value)
                    : values[field.name] === option.value
                "
                class="mt-1"
                @change="select(field, option.value, $event)"
              />
              <span class="min-w-0">
                {{ option.title }}
                <span v-if="option.description" class="block text-xs text-muted-foreground">{{
                  option.description
                }}</span>
                <pre
                  v-if="option.preview"
                  class="max-h-32 overflow-auto whitespace-pre-wrap text-xs"
                  >{{ option.preview }}</pre
                >
              </span>
            </label>
          </template>
          <input
            v-else
            :id="`${formId}-${fieldIndex}`"
            :aria-label="field.title"
            :required="field.required && field.type !== 'boolean'"
            :type="
              field.secret && field.type === 'string'
                ? 'password'
                : field.type === 'boolean'
                  ? 'checkbox'
                  : field.type === 'number' || field.type === 'integer'
                    ? 'number'
                    : field.format === 'date'
                      ? 'date'
                      : field.format === 'email'
                        ? 'email'
                        : field.format === 'uri'
                          ? 'url'
                          : 'text'
            "
            :checked="values[field.name] === true"
            :value="values[field.name] ?? ''"
            :step="field.type === 'integer' ? 1 : 'any'"
            :min="field.minimum"
            :max="field.maximum"
            :minlength="field.minLength"
            :maxlength="field.maxLength"
            :autocomplete="field.secret ? 'off' : undefined"
            :class="
              field.type === 'boolean'
                ? 'size-4'
                : 'h-9 w-full rounded-md border bg-background px-3 text-sm'
            "
            @input="input(field, $event)"
          />
        </fieldset>
      </div>
      <div v-else class="space-y-2">
        <p class="break-all text-sm">{{ requestHost }}</p>
        <p class="break-all text-xs text-muted-foreground">{{ request.url }}</p>
        <DcButton type="button" variant="outline" @click="openUrl">{{
          t('mcp.elicitation.openLink')
        }}</DcButton>
      </div>
      <p v-if="store.errors[request.requestId]" role="alert" class="text-sm text-destructive">
        {{ t('chat.acpExtensions.answerFailed') }}
      </p>
      <div class="flex justify-end gap-2">
        <DcButton
          type="button"
          variant="ghost"
          :disabled="busy"
          @click="store.respond(request.requestId, 'cancel')"
          >{{ t('common.cancel') }}</DcButton
        >
        <DcButton
          type="button"
          variant="outline"
          :disabled="busy"
          @click="store.respond(request.requestId, 'decline')"
          >{{ t('mcp.elicitation.decline') }}</DcButton
        >
        <DcButton type="submit" :disabled="busy">{{ t('mcp.elicitation.accept') }}</DcButton>
      </div>
    </template>
    <template v-else>
      <p role="status" class="text-sm">
        {{
          t(
            request.status === 'completed'
              ? 'chat.acpExtensions.externalComplete'
              : 'chat.acpExtensions.waitingExternal'
          )
        }}
      </p>
      <DcButton
        type="button"
        variant="outline"
        @click="store.respond(request.requestId, 'cancel')"
        >{{ t('common.close') }}</DcButton
      >
    </template>
  </form>
</template>
