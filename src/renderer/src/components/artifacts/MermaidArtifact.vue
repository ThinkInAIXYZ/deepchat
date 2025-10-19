<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <div
      v-if="props.isPreview"
      ref="mermaidRef"
      class="w-full h-full p-4 overflow-auto flex items-center justify-center [&_svg]:!w-full [&_svg]:!h-full [&_svg]:max-h-[calc(100vh-120px)] [&_svg]:object-contain"
    ></div>
    <div v-else class="h-full p-4">
      <pre
        class="rounded-lg bg-muted p-4 h-full m-0 overflow-auto"
      ><code class="font-mono text-sm leading-6 h-full block">{{ props.block.content }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import mermaid from 'mermaid'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
    }
    content: string
  }
  isPreview: boolean
}>()

const mermaidRef = ref<HTMLElement>()

// 初始化 mermaid，使用更合适的配置
onMounted(() => {
  mermaid.initialize({
    startOnLoad: true,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit'
  })

  // 初始渲染
  if (props.isPreview) {
    nextTick(() => renderDiagram())
  }
})

const renderDiagram = async () => {
  if (!mermaidRef.value || !props.block.content) return

  try {
    // Clear previous content
    mermaidRef.value.innerHTML = props.block.content

    // Re-render using mermaid API
    await mermaid.run({
      nodes: [mermaidRef.value]
    })
  } catch (error) {
    console.error('Failed to render mermaid diagram:', error)
    if (mermaidRef.value) {
      // Create localized error message safely without innerHTML
      const msg = error instanceof Error ? error.message : t('common.unknownError')
      const text = t('artifacts.mermaid.renderError', { message: msg })

      // Clear existing content
      mermaidRef.value.innerHTML = ''

      // Create error element and set text safely
      const errorDiv = document.createElement('div')
      errorDiv.classList.add('text-destructive', 'p-4', 'm-0')
      errorDiv.textContent = text

      mermaidRef.value.appendChild(errorDiv)
    }
  }
}

// 监听内容变化和预览状态变化
watch(
  [() => props.block.content, () => props.isPreview],
  async ([newContent, newIsPreview], [oldContent, oldIsPreview]) => {
    if (newIsPreview && (newContent !== oldContent || newIsPreview !== oldIsPreview)) {
      await nextTick()
      renderDiagram()
    }
  }
)
</script>
