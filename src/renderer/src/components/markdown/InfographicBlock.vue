<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue'
import { PreCodeNode, type InfographicBlockNodeProps } from 'markstream-vue'
import { INFOGRAPHIC_RENDER_METHOD, INFOGRAPHIC_STATUS_METHOD } from '@shared/hostViews'
import HostViewFrame from '@/components/mcp/HostViewFrame.vue'

const props = defineProps({
  node: { type: Object as PropType<InfographicBlockNodeProps['node']>, required: true },
  loading: Boolean,
  isDark: Boolean
})

const frame = ref<InstanceType<typeof HostViewFrame> | null>(null)
const ready = ref(false)
const failed = ref(false)
const showSource = computed(() => failed.value && !props.loading)

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
  <HostViewFrame
    v-show="!showSource"
    ref="frame"
    kind="infographic"
    title="Infographic"
    :placeholder-height="240"
    @ready="handleReady"
    @error="failed = true"
    @notification="handleNotification"
  />
</template>
