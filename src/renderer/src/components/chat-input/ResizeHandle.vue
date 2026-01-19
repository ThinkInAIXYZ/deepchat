<template>
  <div
    class="absolute -top-1.5 left-0 right-0 h-3 cursor-ns-resize hover:bg-primary/10 z-20 flex justify-center items-center group opacity-0 hover:opacity-100 transition-opacity"
    @mousedown="handleMouseDown"
  >
    <div
      class="w-16 h-1 bg-muted-foreground/20 rounded-full group-hover:bg-primary/40 transition-colors"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const emit = defineEmits<{
  resize: [height: number]
}>()

const isResizing = ref(false)
const startY = ref(0)
const startHeight = ref(0)

const handleMouseDown = (e: MouseEvent) => {
  isResizing.value = true
  startY.value = e.clientY

  // Get parent container height
  const container = (e.target as HTMLElement).parentElement
  if (container) {
    startHeight.value = container.getBoundingClientRect().height
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isResizing.value) return

  const deltaY = startY.value - e.clientY
  const newHeight = startHeight.value + deltaY

  // Min height 100px, Max height 50% of window height
  const maxHeight = window.innerHeight * 0.5
  if (newHeight > 100 && newHeight < maxHeight) {
    emit('resize', newHeight)
  }
}

const handleMouseUp = () => {
  isResizing.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})
</script>
