<template>
  <MermaidBlockNode v-if="isMermaid" :node="node" />
  <div v-else class="my-4 rounded-lg border border-border overflow-hidden shadow-sm">
    <div class="flex justify-between items-center p-2 bg-gray-100 dark:bg-zinc-800 text-xs">
      <span class="flex items-center space-x-2">
        <Icon :icon="languageIcon" class="w-4 h-4" />
        <span class="text-gray-600 dark:text-gray-400 font-mono font-bold">{{
          displayLanguage
        }}</span>
      </span>
      <div v-if="isPreviewable" class="flex items-center space-x-2">
        <button
          class="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          @click="copyCode"
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
        @click="copyCode"
      >
        {{ copyText }}
      </button>
    </div>
    <div
      ref="codeEditor"
      class="min-h-[30px] max-h-[500px] text-xs overflow-auto bg-gray-50 dark:bg-zinc-900 font-mono leading-relaxed"
      :data-language="node.language"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useThrottleFn } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import MermaidBlockNode from './MermaidBlockNode.vue'

import { anysphereThemeDark, anysphereThemeLight } from '@/lib/code.theme'

// Optional: Import artifact store if needed
import { useArtifactStore } from '@/stores/artifact'
import { nanoid } from 'nanoid'
import { detectLanguage } from '@/lib/code.detect'
import { useThemeStore } from '@/stores/theme'
import { getLanguageExtension, getLanguageIcon, prepareLanguage } from '@/lib/code.lang'

const props = defineProps<{
  node: {
    type: 'code_block'
    language: string
    code: string
    raw: string
  }
  messageId?: string
  threadId?: string
}>()

prepareLanguage()

const { t } = useI18n()
const themeStore = useThemeStore()
const artifactStore = useArtifactStore()
const codeEditor = ref<HTMLElement | null>(null)
const copyText = ref(t('common.copy'))
const editorInstance = ref<EditorView | null>(null)
const codeLanguage = ref(props.node.language || '')

// 创建节流版本的语言检测函数，1秒内最多执行一次
const throttledDetectLanguage = useThrottleFn(
  (code: string) => {
    codeLanguage.value = detectLanguage(code)
    console.log(codeLanguage.value)
  },
  1000,
  true
)

// Initialize language detection if needed, after the function is defined
if (props.node.language === '') {
  throttledDetectLanguage(props.node.code)
}

// Check if the language is previewable (HTML or SVG)
const isPreviewable = computed(() => {
  const lang = codeLanguage.value.trim().toLowerCase()
  return lang === 'html' || lang === 'svg'
})

// Check if the code block is a Mermaid diagram
const isMermaid = computed(() => codeLanguage.value.trim().toLowerCase() === 'mermaid')

watch(
  () => props.node.language,
  (newLanguage) => {
    if (newLanguage === '') {
      throttledDetectLanguage(props.node.code)
    } else {
      codeLanguage.value = newLanguage
    }
  }
)

// 计算用于显示的语言名称
const displayLanguage = computed(() => {
  const lang = codeLanguage.value.trim().toLowerCase()

  // 映射一些常见语言的显示名称
  const languageMap = {
    js: 'JavaScript',
    ts: 'TypeScript',
    jsx: 'JSX',
    tsx: 'TSX',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    json: 'JSON',
    py: 'Python',
    python: 'Python',
    rb: 'Ruby',
    go: 'Go',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    cs: 'C#',
    php: 'PHP',
    sh: 'Shell',
    bash: 'Bash',
    sql: 'SQL',
    yaml: 'YAML',
    md: 'Markdown',
    '': 'Plain Text',
    plain: 'Plain Text'
  }

  return languageMap[lang] || lang.charAt(0).toUpperCase() + lang.slice(1)
})

// Computed property for language icon
const languageIcon = computed(() => {
  const lang = codeLanguage.value.trim().toLowerCase()
  return getLanguageIcon(lang)
})

// 获取语言扩展

// 复制代码
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(props.node.code)
    copyText.value = t('common.copySuccess')
    setTimeout(() => {
      copyText.value = t('common.copy')
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 预览HTML/SVG代码
const previewCode = () => {
  if (!isPreviewable.value || !props.messageId || !props.threadId) return

  const lowerLang = props.node.language.toLowerCase()
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
      content: props.node.code,
      status: 'loaded'
    },
    props.messageId,
    props.threadId
  )
}

// 创建编辑器实例
const createEditor = () => {
  if (!codeEditor.value) return

  // Clean up existing editor if it exists
  if (editorInstance.value) {
    editorInstance.value.destroy()
    editorInstance.value = null
  }

  // Set up CodeMirror extensions
  const extensions = [
    basicSetup,
    themeStore.isDark ? anysphereThemeDark : anysphereThemeLight,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    getLanguageExtension(props.node.language),
    EditorState.readOnly.of(true)
  ]

  try {
    const editorView = new EditorView({
      state: EditorState.create({
        doc: props.node.code,
        extensions
      }),
      parent: codeEditor.value
    })
    editorInstance.value = editorView
    console.log(`Editor initialized for language: ${codeLanguage.value}`)
  } catch (error) {
    console.error('Failed to initialize editor:', error)
    // Fallback: use a simple pre tag
    const escapedCode = props.node.code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
    codeEditor.value.innerHTML = `<pre class="whitespace-pre-wrap text-gray-800 dark:text-gray-200 m-0">${escapedCode}</pre>`
  }
}

// 监听主题变化
watch(
  () => themeStore.isDark,
  () => {
    createEditor()
  }
)

// 监听代码变化
watch(
  () => props.node.code,
  (newCode) => {
    if (!newCode) return

    // If it's a mermaid diagram, re-render it
    if (props.node.language.toLowerCase() === 'mermaid' && codeEditor.value) {
      return
    }

    // Check if we need to detect language
    if (props.node.language === '') {
      throttledDetectLanguage(newCode)
    }

    // For normal code blocks, update the editor content
    if (editorInstance.value) {
      const state = editorInstance.value.state

      editorInstance.value.dispatch({
        changes: { from: 0, to: state.doc.length, insert: newCode }
      })
      // update editor scroll to bottom
      nextTick(() => {
        if (editorInstance.value) {
          const view = editorInstance.value.scrollDOM.parentElement.parentElement;
          view.scrollTop = view.scrollHeight;
        }
      })
    } else {
      // If editor not yet initialized, create it
      createEditor()
    }
  },
  { immediate: true }
)

// 监听语言变化
watch(
  () => props.node.language,
  () => {
    // If the language changes, we need to recreate the editor with the new language
    createEditor()
  }
)

// 初始化代码编辑器
onMounted(() => {
  // Initial language setup is now handled above definitions
  createEditor()
})

// 清理资源
onUnmounted(() => {
  if (editorInstance.value) {
    editorInstance.value.destroy()
    editorInstance.value = null
  }
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
