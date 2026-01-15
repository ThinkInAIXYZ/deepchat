<template>
  <div
    ref="boxRef"
    :id="`message-${id}`"
    :data-message-id="id"
    :data-index="index"
    class="message-box w-full break-all"
    :style="boxStyle"
  >
    <div v-if="inView || !cachedHeight" class="message-box-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'

interface Props {
  id: string
  index: number
  cachedHeight?: number
  inView?: boolean
  observerRef?: IntersectionObserver | null
}

const props = withDefaults(defineProps<Props>(), {
  cachedHeight: undefined,
  inView: false,
  observerRef: null
})

const emit = defineEmits<{
  (e: 'height-change', height: number): void
  (e: 'mounted', element: HTMLElement): void
}>()

const boxRef = ref<HTMLDivElement>()
const measuredHeight = ref<number>(0)

const boxStyle = computed(() => {
  // If not in view and we have a cached height, use it to prevent collapse
  if (!props.inView && props.cachedHeight) {
    return {
      minHeight: `${props.cachedHeight}px`,
      maxHeight: `${props.cachedHeight}px`,
      overflow: 'hidden'
    }
  }
  return {}
})

let resizeObserver: ResizeObserver | null = null

const setupResizeObserver = () => {
  if (!boxRef.value) return

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const newHeight = entry.contentRect.height
      if (newHeight !== measuredHeight.value && newHeight > 0) {
        measuredHeight.value = newHeight
        emit('height-change', newHeight)
      }
    }
  })

  resizeObserver.observe(boxRef.value)
}

const cleanupResizeObserver = () => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
}

onMounted(() => {
  if (boxRef.value) {
    emit('mounted', boxRef.value)
    setupResizeObserver()
  }
})

onBeforeUnmount(() => {
  cleanupResizeObserver()
})

// Watch for inView changes to setup/cleanup observer
watch(
  () => props.inView,
  (isInView) => {
    if (isInView) {
      setupResizeObserver()
    }
  }
)
</script>

<style scoped>
.message-box {
  position: relative;
}

.message-box-content {
  width: 100%;
}
</style>
