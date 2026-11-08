<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntersectionObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { InfographicBlockNodeProps } from 'markstream-vue'
import { DcButton, DcCopyButton } from '@dc-ui/components/button'
import {
  INFOGRAPHIC_EXPORTED_METHOD,
  INFOGRAPHIC_EXPORT_METHOD,
  INFOGRAPHIC_RENDER_METHOD,
  INFOGRAPHIC_STATUS_METHOD
} from '@shared/hostViews'
import HostViewFrame from '@/components/mcp/HostViewFrame.vue'
import { downloadBlob } from '@/lib/download'

const PLACEHOLDER_HEIGHT = 240

const props = defineProps({
  node: { type: Object as PropType<InfographicBlockNodeProps['node']>, required: true },
  loading: Boolean,
  isDark: Boolean
})

const { t } = useI18n()
const placeholder = ref<HTMLElement | null>(null)
const frame = ref<InstanceType<typeof HostViewFrame> | null>(null)
const visible = ref(false)
const ready = ref(false)
const failed = ref(false)
const mode = ref<'preview' | 'source'>('preview')
const collapsed = ref(false)
// The sandbox can send notifications on its own, so only an export the user asked for may start a
// download.
const exportRequested = ref(false)
// The last chunk's status can arrive after loading ends; falling back before it would drop a valid
// final render.
const pendingRenders = ref(0)
const showSource = computed(() => failed.value && !props.loading && pendingRenders.value === 0)
const canExport = computed(() => ready.value && !failed.value && !exportRequested.value)

// Each frame is its own renderer process, so offscreen blocks wait until they near the viewport.
const { stop } = useIntersectionObserver(
  placeholder,
  ([entry]) => {
    if (!entry?.isIntersecting) return
    visible.value = true
    stop()
  },
  { rootMargin: '160px' }
)

const render = () => {
  if (!ready.value || !frame.value) return
  pendingRenders.value += 1
  frame.value
    .notify(INFOGRAPHIC_RENDER_METHOD, {
      source: props.node.code,
      theme: props.isDark ? 'dark' : 'light'
    })
    .catch(() => {
      pendingRenders.value = Math.max(0, pendingRenders.value - 1)
      failed.value = true
    })
}

const requestExport = () => {
  if (!canExport.value || !frame.value) return
  exportRequested.value = true
  frame.value.notify(INFOGRAPHIC_EXPORT_METHOD, {}).catch(() => {
    exportRequested.value = false
  })
}

const handleNotification = (method: string, params: Record<string, unknown>) => {
  if (method === INFOGRAPHIC_STATUS_METHOD) {
    pendingRenders.value = Math.max(0, pendingRenders.value - 1)
    failed.value = params.ok !== true
    return
  }
  if (method === INFOGRAPHIC_EXPORTED_METHOD && exportRequested.value) {
    exportRequested.value = false
    if (typeof params.svg === 'string') {
      downloadBlob(
        new Blob([params.svg], { type: 'image/svg+xml;charset=utf-8' }),
        `infographic-${Date.now()}.svg`
      )
    }
  }
}

const handleReady = () => {
  ready.value = true
  render()
}

watch(() => [props.node.code, props.isDark], render)
</script>

<template>
  <div class="infographic-block overflow-hidden rounded-lg border">
    <div class="infographic-header flex items-center justify-between gap-2 border-b">
      <span class="infographic-label font-mono font-medium">Infographic</span>
      <div class="flex items-center gap-0.5">
        <DcButton
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-xs"
          :class="{ 'bg-accent': mode === 'preview' && !showSource }"
          :disabled="showSource"
          @click="mode = 'preview'"
        >
          <Icon icon="lucide:eye" class="size-3.5" />
          {{ t('common.preview') }}
        </DcButton>
        <DcButton
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-xs"
          :class="{ 'bg-accent': mode === 'source' || showSource }"
          @click="mode = 'source'"
        >
          <Icon icon="lucide:code" class="size-3.5" />
          {{ t('common.source') }}
        </DcButton>
      </div>
      <div class="flex items-center gap-0.5">
        <DcButton
          variant="ghost"
          size="icon-xs"
          :aria-label="collapsed ? t('common.expand') : t('common.collapse')"
          :tooltip="collapsed ? t('common.expand') : t('common.collapse')"
          @click="collapsed = !collapsed"
        >
          <Icon
            icon="lucide:chevron-right"
            class="size-3.5 transition-transform"
            :class="{ 'rotate-90': !collapsed }"
          />
        </DcButton>
        <DcCopyButton
          size="icon-xs"
          :copy-text="node.code"
          :aria-label="t('common.copy')"
          :tooltip="t('common.copy')"
        />
        <DcButton
          variant="ghost"
          size="icon-xs"
          :aria-label="t('common.export')"
          :tooltip="t('common.export')"
          :disabled="!canExport"
          @click="requestExport"
        >
          <Icon icon="lucide:download" class="size-3.5" />
        </DcButton>
      </div>
    </div>
    <div v-show="!collapsed">
      <pre
        v-if="showSource || mode === 'source'"
        class="infographic-source font-mono text-sm whitespace-pre-wrap"
        >{{ node.code }}</pre
      >
      <div v-if="!showSource" v-show="mode === 'preview'">
        <div v-if="!visible" ref="placeholder" :style="{ height: `${PLACEHOLDER_HEIGHT}px` }" />
        <HostViewFrame
          v-else
          ref="frame"
          kind="infographic"
          title="Infographic"
          :placeholder-height="PLACEHOLDER_HEIGHT"
          @ready="handleReady"
          @error="failed = true"
          @notification="handleNotification"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.infographic-block {
  margin: var(--ms-flow-diagram-y) 0;
  background: var(--diagram-bg);
  border-color: var(--diagram-border);
  color: hsl(var(--ms-foreground));
}

.infographic-header {
  padding: var(--ms-inset-panel-y) var(--ms-inset-panel-x);
  background: var(--diagram-header-bg);
  border-color: var(--diagram-border);
}

.infographic-label {
  font-size: var(--ms-text-label);
  color: hsl(var(--ms-muted-foreground));
}

.infographic-source {
  margin: 0;
  padding: var(--ms-inset-panel-body);
}
</style>
