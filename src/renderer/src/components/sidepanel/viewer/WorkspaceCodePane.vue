<template>
  <div class="flex h-full min-h-0 w-full overflow-hidden bg-background">
    <div
      ref="editorRef"
      class="workspace-code-editor-host h-full min-h-0 w-full flex-1"
      :data-language="resolvedLanguage"
      data-testid="workspace-code-pane"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useStreamDiffEditor } from '@/composables/useStreamDiffEditor'
import { useThemeStore } from '@/stores/theme'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'

type WorkspaceCodeSource = {
  id: string
  content: string
  language?: string | null
  type?: string
}

const props = defineProps<{
  source: WorkspaceCodeSource
}>()

const uiSettingsStore = useUiSettingsStore()
const themeStore = useThemeStore()
const editorRef = ref<HTMLElement | null>(null)
const editorInitialized = ref(false)
let createEditorTask: Promise<void> | null = null
const resolvedTheme = computed(() => (themeStore.isDark ? 'vitesse-dark' : 'vitesse-light'))

const { createEditor, updateCode, cleanupEditor, getEditorView, getEditor } = useStreamDiffEditor({
  readOnly: true,
  wordWrap: true,
  lineNumbers: true,
  theme: resolvedTheme.value,
  fontFamily: uiSettingsStore.formattedCodeFontFamily,
  fontSize: 13,
  fileName: props.source.id
})

const LANGUAGE_ALIASES: Record<string, string> = {
  md: 'markdown',
  mdx: 'markdown',
  txt: 'plaintext',
  text: 'plaintext',
  plain: 'plaintext',
  htm: 'html',
  xhtml: 'html',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  sh: 'shell',
  shell: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  docker: 'dockerfile',
  svg: 'xml'
}

const sanitizeLanguage = (language: string | undefined | null): string => {
  if (!language) return ''

  const normalized = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

const resolveLanguage = (source: WorkspaceCodeSource): string => {
  const explicit = sanitizeLanguage(source.language)
  if (explicit) {
    return explicit
  }

  const type = source.type?.trim().toLowerCase() ?? ''
  if (!type) {
    return 'plaintext'
  }

  switch (type) {
    case 'application/vnd.ant.code':
      return 'plaintext'
    case 'text/markdown':
      return 'markdown'
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html'
    case 'image/svg+xml':
      return 'xml'
    case 'application/vnd.ant.mermaid':
      return 'plaintext'
    case 'application/vnd.ant.react':
      return 'javascript'
    case 'application/json':
    case 'application/ld+json':
      return 'json'
    case 'application/xml':
      return 'xml'
    case 'application/x-yaml':
    case 'application/yaml':
      return 'yaml'
    default:
      if (type.endsWith('+json')) {
        return 'json'
      }
      if (type.endsWith('+xml')) {
        return 'xml'
      }
      if (type.startsWith('text/')) {
        return 'plaintext'
      }
      return sanitizeLanguage(type) || 'plaintext'
  }
}

const resolvedLanguage = computed(() => resolveLanguage(props.source))

const applyFontFamily = (fontFamily: string) => {
  getEditorView()?.updateOptions({ fontFamily })
}

const applyTheme = async () => {
  try {
    getEditor().setTheme(resolvedTheme.value)
  } catch (error) {
    console.warn('[WorkspaceCodePane] Failed to apply Monaco theme:', error)
  }
}

const layoutEditor = () => {
  try {
    getEditorView()?.layout()
  } catch (error) {
    console.warn('[WorkspaceCodePane] Failed to layout Monaco editor:', error)
  }
}

const syncEditor = async () => {
  const editorElement = editorRef.value
  if (!editorElement) {
    return
  }

  const nextContent = props.source.content ?? ''
  const nextLanguage = resolvedLanguage.value

  if (!editorInitialized.value) {
    if (createEditorTask) {
      await createEditorTask
      return
    }

    createEditorTask = (async () => {
      await createEditor(editorElement, nextContent, nextLanguage)
      editorInitialized.value = true
      await applyTheme()
      applyFontFamily(uiSettingsStore.formattedCodeFontFamily)
      layoutEditor()
    })()

    try {
      await createEditorTask
    } finally {
      createEditorTask = null
    }
    return
  }

  updateCode(nextContent, nextLanguage)
  layoutEditor()
}

watch(
  () => [editorRef.value, props.source.id, props.source.content, resolvedLanguage.value] as const,
  async () => {
    await nextTick()
    await syncEditor()
  },
  {
    immediate: true,
    flush: 'post'
  }
)

watch(
  () => uiSettingsStore.formattedCodeFontFamily,
  (fontFamily) => {
    applyFontFamily(fontFamily)
  }
)

watch(
  resolvedTheme,
  () => {
    if (!editorInitialized.value) {
      return
    }

    void applyTheme()
  },
  {
    flush: 'post'
  }
)

watch(editorRef, (value) => {
  if (value) {
    return
  }

  cleanupEditor()
  editorInitialized.value = false
  createEditorTask = null
})

onBeforeUnmount(() => {
  cleanupEditor()
  editorInitialized.value = false
  createEditorTask = null
})
</script>

<style scoped>
.workspace-code-editor-host {
  display: block;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: auto !important;
}

.workspace-code-editor-host :deep([data-file]) {
  min-height: 100%;
}
</style>
