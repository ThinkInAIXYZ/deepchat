<template>
  <div :class="containerClasses" data-testid="html-artifact-root">
    <div :class="frameContainerClasses">
      <iframe
        ref="iframeRef"
        :srcdoc="block.content"
        :class="viewportClasses"
        :style="viewportStyles"
        sandbox="allow-scripts allow-same-origin"
        data-testid="html-artifact-iframe"
      ></iframe>
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
const resolvedViewportSize = computed(() => props.viewportSize || 'desktop')

const containerClasses = computed(() => {
  if (resolvedViewportSize.value === 'desktop') {
    return 'flex h-full min-h-0 w-full overflow-hidden'
  }

  return 'flex h-full min-h-0 w-full items-center justify-center overflow-auto'
})

const frameContainerClasses = computed(() => {
  if (resolvedViewportSize.value === 'desktop') {
    return 'h-full min-h-0 w-full'
  }

  return 'relative shrink-0'
})

const viewportClasses = computed(() => {
  const size = resolvedViewportSize.value
  const baseClasses = 'html-iframe-wrapper transition-all duration-300 ease-in-out'

  switch (size) {
    case 'mobile':
    case 'tablet':
      return `${baseClasses} border border-gray-300 dark:border-gray-600 relative`
    default:
      return `${baseClasses} block h-full min-h-0 w-full`
  }
})

const viewportStyles = computed(() => {
  const size = resolvedViewportSize.value

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
      const viewportSize = resolvedViewportSize.value
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
        font-family: var(--dc-font-family, Arial, sans-serif);
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
