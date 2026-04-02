<template>
  <div
    class="chat-search-bar flex w-full max-w-[24rem] items-center gap-2 rounded-2xl border bg-background/90 px-2.5 py-2 shadow-lg backdrop-blur-xl"
  >
    <div class="relative min-w-0 flex-1">
      <Icon
        icon="lucide:search"
        class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70"
      />
      <Input
        ref="inputRef"
        :model-value="modelValue"
        class="h-8 border-0 bg-transparent pl-8 pr-2 text-sm shadow-none focus-visible:ring-0"
        :placeholder="t('chat.inlineSearch.placeholder')"
        :aria-label="t('chat.inlineSearch.ariaLabel')"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        @update:model-value="emit('update:modelValue', $event)"
        @keydown="handleKeydown"
      />
    </div>

    <span
      class="min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground"
      aria-live="polite"
    >
      {{ totalMatches > 0 ? `${activeMatch + 1} / ${totalMatches}` : '0 / 0' }}
    </span>

    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 rounded-xl text-muted-foreground hover:text-foreground"
        :title="t('chat.inlineSearch.previous')"
        :aria-label="t('chat.inlineSearch.previous')"
        @click="emit('previous')"
      >
        <Icon icon="lucide:chevron-up" class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 rounded-xl text-muted-foreground hover:text-foreground"
        :title="t('chat.inlineSearch.next')"
        :aria-label="t('chat.inlineSearch.next')"
        @click="emit('next')"
      >
        <Icon icon="lucide:chevron-down" class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 rounded-xl text-muted-foreground hover:text-foreground"
        :title="t('chat.inlineSearch.close')"
        :aria-label="t('chat.inlineSearch.close')"
        @click="emit('close')"
      >
        <Icon icon="lucide:x" class="h-4 w-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'

defineProps<{
  modelValue: string
  activeMatch: number
  totalMatches: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  previous: []
  next: []
  close: []
}>()

const { t } = useI18n()
const inputRef = ref<InstanceType<typeof Input> | HTMLInputElement | null>(null)

const resolveInputElement = (): HTMLInputElement | null => {
  const candidate = inputRef.value
  if (candidate instanceof HTMLInputElement) {
    return candidate
  }

  if (candidate && '$el' in candidate) {
    const rootElement = candidate.$el as HTMLElement | HTMLInputElement | undefined
    if (rootElement instanceof HTMLInputElement) {
      return rootElement
    }

    const nestedInput = rootElement?.querySelector('input')
    return nestedInput instanceof HTMLInputElement ? nestedInput : null
  }

  return null
}

const focusInput = () => {
  resolveInputElement()?.focus()
}

const selectInput = () => {
  const element = resolveInputElement()
  element?.focus()
  element?.select()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  if (event.shiftKey) {
    emit('previous')
    return
  }

  emit('next')
}

defineExpose({
  focusInput,
  selectInput
})
</script>
