<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { PreCodeNode, type InfographicBlockNodeProps } from 'markstream-vue'
import { INFOGRAPHIC_RENDER_METHOD, INFOGRAPHIC_STATUS_METHOD } from '@shared/hostViews'
import HostViewFrame from '@/components/mcp/HostViewFrame.vue'

const PLACEHOLDER_HEIGHT = 240

const props = defineProps({
  node: { type: Object as PropType<InfographicBlockNodeProps['node']>, required: true },
  loading: Boolean,
  isDark: Boolean
})

const placeholder = ref<HTMLElement | null>(null)
const frame = ref<InstanceType<typeof HostViewFrame> | null>(null)
const visible = ref(false)
const ready = ref(false)
const failed = ref(false)
const showSource = computed(() => failed.value && !props.loading)

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
  if (!ready.value) return
  frame.value?.notify(INFOGRAPHIC_RENDER_METHOD, {
    source: props.node.code,
    theme: props.isDark ? 'dark' : 'light'
  })
}

const handleNotification = (method: string, params: Record<string, unknown>) => {
  if (method === INFOGRAPHIC_STATUS_METHOD) {
    failed.value = params.ok !== true
  }
}

const handleReady = () => {
  ready.value = true
  render()
}

watch(() => [props.node.code, props.isDark], render)
</script>

<template>
  <PreCodeNode v-if="showSource" :node="node" />
  <div v-else-if="!visible" ref="placeholder" :style="{ height: `${PLACEHOLDER_HEIGHT}px` }" />
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
</template>
