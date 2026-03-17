<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FloatingWidgetSessionItem } from '@shared/types/floating-widget'

defineOptions({
  name: 'FloatingSessionItem'
})

const props = defineProps<{
  session: FloatingWidgetSessionItem
}>()

const emit = defineEmits<{
  select: [sessionId: string]
}>()

const { t } = useI18n()

const statusLabel = computed(() => {
  switch (props.session.status) {
    case 'in_progress':
      return t('chat.floatingWidget.status.inProgress')
    case 'error':
      return t('chat.floatingWidget.status.error')
    case 'done':
    default:
      return t('chat.floatingWidget.status.done')
  }
})

const statusClass = computed(() => {
  switch (props.session.status) {
    case 'in_progress':
      return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-[#1a232b] dark:text-white/72'
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/18 dark:bg-[#27161b] dark:text-rose-100'
    case 'done':
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/18 dark:bg-[#102219] dark:text-emerald-100'
  }
})

const itemClass = computed(() => {
  switch (props.session.status) {
    case 'in_progress':
      return 'border-black/8 bg-white/94 hover:border-black/12 hover:bg-white dark:border-[#26303a] dark:bg-[#131a20] dark:hover:border-[#33404c] dark:hover:bg-[#192128]'
    case 'error':
      return 'border-rose-200/90 bg-rose-50/88 hover:border-rose-300 hover:bg-rose-50 dark:border-rose-500/14 dark:bg-[#1c1418] dark:hover:border-rose-400/22 dark:hover:bg-[#24181d]'
    case 'done':
    default:
      return 'border-black/8 bg-white/94 hover:border-emerald-200 hover:bg-white dark:border-[#26303a] dark:bg-[#131a20] dark:hover:border-emerald-500/20 dark:hover:bg-[#192128]'
  }
})

const accentClass = computed(() => {
  switch (props.session.status) {
    case 'in_progress':
      return 'bg-slate-400/80 shadow-[0_0_16px_rgba(148,163,184,0.22)] dark:bg-white/24 dark:shadow-none'
    case 'error':
      return 'bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.2)] dark:bg-rose-300 dark:shadow-[0_0_18px_rgba(251,113,133,0.26)]'
    case 'done':
    default:
      return 'bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.26)] dark:bg-emerald-300 dark:shadow-[0_0_18px_rgba(52,211,153,0.38)]'
  }
})

const dotClass = computed(() => {
  switch (props.session.status) {
    case 'in_progress':
      return 'bg-slate-500 shadow-[0_0_10px_rgba(100,116,139,0.28)] animate-pulse dark:bg-white/55 dark:shadow-none'
    case 'error':
      return 'bg-rose-500 dark:bg-rose-300'
    case 'done':
    default:
      return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.28)] dark:bg-emerald-300 dark:shadow-[0_0_10px_rgba(52,211,153,0.7)]'
  }
})
</script>

<template>
  <button
    type="button"
    data-no-drag
    class="session-card group flex w-full items-center gap-3 border pl-4 pr-5 py-3 text-left"
    :class="itemClass"
    @click="emit('select', session.id)"
  >
    <span class="h-8 w-1.5 shrink-0 rounded-full" :class="accentClass"></span>

    <div
      class="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground/90 dark:text-white/94"
    >
      {{ session.title || t('chat.floatingWidget.untitled') }}
    </div>

    <div
      class="flex min-w-14 box-border items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2 py-1 text-[11px] font-medium"
      :class="statusClass"
    >
      <div class="size-1.5 shrink-0 rounded-full" :class="dotClass"></div>
      <div>{{ statusLabel }}</div>
    </div>
  </button>
</template>

<style scoped>
.session-card {
  position: relative;
  overflow: hidden;
  backface-visibility: hidden;
  transform: translateZ(0);
  transition:
    transform 140ms ease,
    border-color 180ms ease,
    background-color 180ms ease,
    box-shadow 180ms ease;
}

.session-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.session-card:hover {
  transform: translateY(-1px);
}
</style>
