<template>
  <div class="mermaid-artifact artifact-dialog-content">
    <div
      v-if="props.isPreview"
      ref="mermaidRef"
      class="mermaid h-full flex items-center justify-center"
    ></div>
    <div v-else class="h-full p-4">
      <pre class="rounded-lg bg-muted p-4 h-full"><code>{{ props.block.content }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import mermaid from 'mermaid'

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
    // 清空之前的内容
    mermaidRef.value.innerHTML = props.block.content

    // 使用 mermaid API 重新渲染
    await mermaid.run({
      nodes: [mermaidRef.value]
    })
  } catch (error) {
    console.error('Failed to render mermaid diagram:', error)
    if (mermaidRef.value) {
      mermaidRef.value.innerHTML = `<div class="text-destructive p-4">渲染失败: ${error instanceof Error ? error.message : '未知错误'}</div>`
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

<style scoped>
.mermaid-artifact {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mermaid {
  width: 100%;
  height: 100%;
  padding: 1rem;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mermaid :deep(svg) {
  width: 100% !important;
  height: 100% !important;
  max-height: calc(100vh - 120px);
  object-fit: contain;
}

pre {
  margin: 0;
  overflow: auto;
  height: 100%;
}

code {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  height: 100%;
  display: block;
}
</style>
