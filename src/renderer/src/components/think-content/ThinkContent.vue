<template>
  <section
    class="rounded-xl border border-reasoning-border bg-reasoning-surface text-reasoning-foreground shadow-sm"
    :data-state="collapsed ? 'collapsed' : 'expanded'"
  >
    <header class="flex items-center gap-3 px-3 py-2.5">
      <button
        v-if="collapsible"
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-reasoning-foreground/70 transition hover:bg-reasoning-icon/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-reasoning-icon"
        :aria-expanded="!collapsed"
        :aria-controls="contentId"
        @click="toggle"
      >
        <Icon :icon="collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" class="h-4 w-4" />
      </button>
      <div class="flex items-center gap-3">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-lg bg-reasoning-icon/10 text-reasoning-icon shadow-inner"
        >
          <Icon :icon="icon" class="h-4 w-4" />
        </div>
        <div class="flex flex-col leading-tight">
          <span
            v-if="headerLabel"
            class="text-[11px] font-medium uppercase tracking-[0.08em] text-reasoning-foreground/65"
          >
            {{ headerLabel }}
          </span>
          <span class="text-sm font-semibold text-reasoning-foreground">{{ title }}</span>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2 text-xs text-reasoning-foreground/65">
        <slot name="meta">
          <template v-if="meta">{{ meta }}</template>
        </slot>
      </div>
    </header>
    <div
      v-show="!collapsed"
      :id="contentId"
      class="px-3 pb-3 text-sm"
    >
      <div class="prose prose-sm max-w-none break-words leading-relaxed text-reasoning-foreground/90 dark:prose-invert">
        <NodeRenderer :renderCodeBlocksAsPre="true" :content="content" />
      </div>
    </div>
    <footer v-if="loading" class="flex items-center gap-2 px-3 pb-3 text-xs text-reasoning-foreground/70">
      <Icon icon="lucide:loader-circle" class="h-4 w-4 animate-spin" />
      <span>{{ progressText }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import NodeRenderer from 'vue-renderer-markdown'

const props = withDefaults(
  defineProps<{
    title: string
    content: string
    meta?: string
    headerLabel?: string
    progressLabel?: string
    icon?: string
    collapsed?: boolean
    defaultCollapsed?: boolean
    collapsible?: boolean
    loading?: boolean
  }>(),
  {
    meta: undefined,
    headerLabel: undefined,
    progressLabel: undefined,
    icon: 'lucide:brain',
    collapsed: undefined,
    defaultCollapsed: false,
    collapsible: true,
    loading: false,
  }
)

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void
}>()

const internalCollapsed = ref(props.defaultCollapsed)

watch(
  () => props.collapsed,
  (value) => {
    if (value === undefined) return
    internalCollapsed.value = value
  }
)

const collapsed = computed({
  get: () => (props.collapsed === undefined ? internalCollapsed.value : props.collapsed),
  set: (value: boolean) => {
    if (props.collapsed === undefined) {
      internalCollapsed.value = value
    }
    emit('update:collapsed', value)
  },
})

const toggle = () => {
  if (!props.collapsible) return
  collapsed.value = !collapsed.value
}

const meta = computed(() => props.meta)
const headerLabel = computed(() => props.headerLabel)
const progressText = computed(() => props.progressLabel ?? props.headerLabel ?? props.title)
const icon = computed(() => props.icon)

const contentId = `think-content-${Math.random().toString(36).slice(2, 8)}`
</script>
