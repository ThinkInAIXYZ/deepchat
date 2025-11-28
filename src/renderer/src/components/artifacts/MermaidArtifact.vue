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

/**
 * 过滤 Mermaid 内容中的危险 HTML 标签和属性，防止 XSS 攻击
 * 参考 svgSanitizer.ts 和 deeplinkPresenter 的实现
 */
const sanitizeMermaidContent = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return ''
  }

  let sanitized = content

  // 移除危险的 HTML 标签及其内容
  const dangerousTags = [
    // Script 标签 - 允许执行 JavaScript
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    // Iframe 标签 - 可以嵌入恶意内容
    /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
    // Object 和 Embed 标签 - 可以执行代码
    /<object[^>]*>[\s\S]*?<\/object>/gi,
    /<embed[^>]*[^>]*>/gi,
    // Form 标签 - 可能用于 CSRF
    /<form[^>]*>[\s\S]*?<\/form>/gi,
    // Link 标签 - 可能加载恶意样式或脚本
    /<link[^>]*>/gi,
    // Style 标签 - 可能包含恶意 CSS
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    // Meta 标签 - 可能用于重定向或执行
    /<meta[^>]*>/gi,
    // Img 标签 - PoC 中使用的攻击向量，带事件处理器特别危险
    /<img[^>]*>/gi
  ]

  // 移除危险标签
  for (const pattern of dangerousTags) {
    sanitized = sanitized.replace(pattern, '')
  }

  // 移除所有事件处理器属性 (on* 属性)
  // 这包括 onerror, onclick, onload, onmouseover 等
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')

  // 移除危险的协议
  const dangerousProtocols = [/javascript\s*:/gi, /vbscript\s*:/gi, /data\s*:\s*text\/html/gi]

  for (const pattern of dangerousProtocols) {
    sanitized = sanitized.replace(pattern, '')
  }

  return sanitized
}

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
    const sanitizedContent = sanitizeMermaidContent(props.block.content)
    mermaidRef.value.innerHTML = sanitizedContent

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
