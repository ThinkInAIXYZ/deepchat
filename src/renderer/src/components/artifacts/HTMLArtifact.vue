<template>
  <div class="w-full h-full overflow-auto">
    <div
      class="relative w-full h-full"
      :class="viewportSize !== 'desktop' ? 'flex items-center justify-center' : ''"
    >
      <div :class="viewportSize === 'desktop' ? 'relative w-full h-full' : 'relative'">
        <iframe
          ref="iframeRef"
          :srcdoc="block.content"
          :class="viewportClasses"
          :style="viewportStyles"
          sandbox="allow-scripts allow-same-origin"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'

// Fixed viewport dimensions
const VIEWPORT_SIZES = {
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 }
}

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
  isPreview: boolean
  viewportSize?: 'desktop' | 'tablet' | 'mobile'
}>()

const iframeRef = ref<HTMLIFrameElement>()

const viewportClasses = computed(() => {
  const size = props.viewportSize || 'desktop'
  const baseClasses = 'html-iframe-wrapper transition-all duration-300 ease-in-out'

  switch (size) {
    case 'mobile':
    case 'tablet':
      return `${baseClasses} border border-gray-300 dark:border-gray-600 relative`
    default:
      return `${baseClasses} w-full h-full`
  }
})

const viewportStyles = computed(() => {
  const size = props.viewportSize || 'desktop'

  if (size === 'mobile' || size === 'tablet') {
    const dimensions = VIEWPORT_SIZES[size]
    return {
      width: `${dimensions.width}px`,
      height: `${dimensions.height}px`
    }
  }

  return {}
})

const setupIframe = () => {
  if (props.isPreview && iframeRef.value) {
    const iframe = iframeRef.value
    iframe.onload = () => {
      const doc = iframe.contentDocument
      if (!doc) return

      // Add viewport meta tag
      const viewportSize = props.viewportSize || 'desktop'
      let viewportContent = 'width=device-width, initial-scale=1.0'

      if (viewportSize === 'mobile' || viewportSize === 'tablet') {
        const width = VIEWPORT_SIZES[viewportSize].width
        viewportContent = `width=${width}, initial-scale=1.0`
      }

      // Remove existing viewport meta tag
      const existingViewport = doc.querySelector('meta[name="viewport"]')
      if (existingViewport) {
        existingViewport.remove()
      }

      // Add new viewport meta tag
      const viewportMeta = doc.createElement('meta')
      viewportMeta.name = 'viewport'
      viewportMeta.content = viewportContent
      doc.head.appendChild(viewportMeta)

      // Add base styles
      const resetCSS = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        height: 100%;
        font-family: Arial, sans-serif;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      a {
        text-decoration: none;
        color: inherit;
      }
    `
      const styleElement = doc.createElement('style')
      styleElement.textContent = resetCSS
      doc.head.appendChild(styleElement)
    }
  }
}

onMounted(() => {
  setupIframe()
})

// Watch viewport size changes
watch(
  () => props.viewportSize,
  () => {
    setupIframe()
  }
)
</script>
