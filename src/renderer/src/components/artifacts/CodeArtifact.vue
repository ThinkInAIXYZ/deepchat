<template>
  <MermaidBlockNode v-if="isMermaid" :node="mermaidNode" />
  <div v-else class="m-4 rounded-lg border border-border overflow-hidden shadow-sm">
    <div class="flex justify-between items-center p-2 bg-muted text-xs">
      <span class="flex items-center space-x-2">
        <Icon :icon="languageIcon" class="w-4 h-4" />
        <span class="text-gray-600 dark:text-gray-400 font-mono font-bold">{{
          displayLanguage
        }}</span>
      </span>
      <div v-if="isPreviewable" class="flex items-center space-x-2">
        <button
          class="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          @click="handleCopy"
        >
          {{ copyText }}
        </button>
        <button
          class="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          @click="previewCode"
        >
          {{ t('artifacts.preview') }}
        </button>
      </div>
      <button
        v-else
        class="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
        @click="handleCopy"
      >
        {{ copyText }}
      </button>
    </div>
    <div
      ref="codeEditor"
      class="min-h-[30px] max-h-[500px] text-xs overflow-auto bg-background font-mono leading-relaxed"
      :data-language="codeLanguage"
    ></div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThrottleFn } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { MermaidBlockNode } from 'vue-renderer-markdown'
import { useArtifactStore } from '@/stores/artifact'
import { getLanguageIcon } from 'vue-renderer-markdown'
import { detectLanguage, useMonaco } from 'vue-use-monaco'
import { nanoid } from 'nanoid'

const props = defineProps<{
  block: {
    artifact: {
      type: string
      title: string
      language?: string
    }
    content: string
  }
  isPreview: boolean
  messageId?: string
  threadId?: string
}>()

const { t } = useI18n()
const { createEditor, updateCode } = useMonaco({
  wordWrap: 'on',
  wrappingIndent: 'same'
})
const artifactStore = useArtifactStore()
const copyText = ref(t('common.copy'))
const codeEditor = ref<HTMLElement>()
const codeLanguage = ref(props.block.artifact?.language?.trim().toLowerCase() || '')

// 创建节流版本的语言检测函数，1秒内最多执行一次
const throttledDetectLanguage = useThrottleFn(
  (code: string) => {
    codeLanguage.value = detectLanguage(code)
    console.log('Detected language:', codeLanguage.value)
  },
  1000,
  true
)

// Initialize language detection if needed
if (!codeLanguage.value || codeLanguage.value === '') {
  throttledDetectLanguage(props.block.content)
}

// Check if the code block is a Mermaid diagram
const isMermaid = computed(() => codeLanguage.value === 'mermaid')

// Create mermaid node for MermaidBlockNode component
const mermaidNode = computed(() => ({
  type: 'code_block' as const,
  language: 'mermaid',
  code: props.block.content,
  raw: props.block.content
}))

// Check if the language is previewable (HTML or SVG)
const isPreviewable = computed(() => {
  const lang = codeLanguage.value
  return lang === 'html' || lang === 'svg'
})

// 获取语言图标
const languageIcon = computed(() => {
  return getLanguageIcon(codeLanguage.value)
})

// 获取显示用的语言名称
const displayLanguage = computed(() => {
  const lang = codeLanguage.value
  const displayNames: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    cpp: 'C++',
    csharp: 'C#',
    php: 'PHP',
    ruby: 'Ruby',
    go: 'Go',
    rust: 'Rust',
    swift: 'Swift',
    kotlin: 'Kotlin',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sql: 'SQL',
    json: 'JSON',
    yaml: 'YAML',
    markdown: 'Markdown',
    bash: 'Bash',
    shell: 'Shell',
    powershell: 'PowerShell',
    dockerfile: 'Dockerfile',
    vue: 'Vue',
    react: 'React',
    xml: 'XML',
    svg: 'SVG',
    mermaid: 'Mermaid',
    text: 'Plain Text',
    http: 'HTTP',
    uri: 'URI',
    dos: 'DOS Batch',
    '': 'Plain Text'
  }
  return displayNames[lang] || lang.charAt(0).toUpperCase() + lang.slice(1)
})

const handleCopy = async () => {
  try {
    if (window.api?.copyText) {
      window.api.copyText(props.block.content)
    } else {
      await navigator.clipboard.writeText(props.block.content)
    }
    copyText.value = t('common.copySuccess')
    setTimeout(() => {
      copyText.value = t('common.copy')
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

// 预览HTML/SVG代码
const previewCode = () => {
  if (!isPreviewable.value || !props.messageId || !props.threadId) return

  const lowerLang = codeLanguage.value
  const artifactType = lowerLang === 'html' ? 'text/html' : 'image/svg+xml'
  const artifactTitle =
    lowerLang === 'html'
      ? t('artifacts.htmlPreviewTitle') || 'HTML Preview'
      : t('artifacts.svgPreviewTitle') || 'SVG Preview'

  artifactStore.showArtifact(
    {
      id: `temp-${lowerLang}-${nanoid()}`,
      type: artifactType,
      title: artifactTitle,
      language: lowerLang || props.block.artifact?.language,
      content: props.block.content,
      status: 'loaded'
    },
    props.messageId,
    props.threadId
  )
}

// 监听代码变化
watch(
  () => props.block.content,
  (newCode) => {
    if (!newCode) return

    // If it's a mermaid diagram, let MermaidBlockNode handle it
    if (codeLanguage.value === 'mermaid') {
      return
    }

    // Check if we need to detect language
    if (!codeLanguage.value || codeLanguage.value === '') {
      throttledDetectLanguage(newCode)
    }

    updateCode(props.block.content, codeLanguage.value)
  },
  { immediate: true }
)

// 监听语言变化
watch(
  () => props.block.artifact?.language,
  (newLanguage) => {
    const normalizedLang = newLanguage?.trim().toLowerCase() || ''
    if (normalizedLang === '') {
      throttledDetectLanguage(props.block.content)
    } else {
      codeLanguage.value = normalizedLang
    }
    // If the language changes, we need to recreate the editor with the new language
  }
)

// 监听计算出的语言变化
watch(
  () => codeLanguage.value,
  () => {
    // If the computed language changes, we need to recreate the editor
    updateCode(props.block.content, codeLanguage.value)
  }
)

// 初始化代码编辑器
onMounted(() => {
  if (!codeEditor.value) return
  createEditor(codeEditor.value, props.block.content, codeLanguage.value)
})
</script>
<style>
/* Ensure CodeMirror inherits the right font in the editor */
.cm-editor .cm-content {
  font-family:
    ui-monospace,
    SFMono-Regular,
    SF Mono,
    Menlo,
    Consolas,
    Liberation Mono,
    monospace !important;
}
</style>
