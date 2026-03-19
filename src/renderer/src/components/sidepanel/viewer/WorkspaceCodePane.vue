<template>
  <div class="h-full min-h-0 overflow-hidden bg-background">
    <div
      ref="editorRef"
      class="h-full w-full"
      :data-language="resolvedLanguage"
      data-testid="workspace-code-pane"
    ></div>
  </div>
</template>

<script setup lang="ts">
import * as monaco from 'monaco-editor'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
const editorRef = ref<HTMLElement | null>(null)
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
const model = shallowRef<monaco.editor.ITextModel | null>(null)

let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let currentSourceId: string | null = null

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

const getThemeName = () => {
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs'
}

const applyTheme = () => {
  monaco.editor.setTheme(getThemeName())
}

const layoutEditor = () => {
  editor.value?.layout()
}

const disposeModel = () => {
  model.value?.dispose()
  model.value = null
  currentSourceId = null
}

const syncModel = () => {
  if (!editor.value) {
    return
  }

  const nextLanguage = resolvedLanguage.value
  const nextContent = props.source.content ?? ''

  if (!model.value || currentSourceId !== props.source.id) {
    disposeModel()
    model.value = monaco.editor.createModel(nextContent, nextLanguage)
    currentSourceId = props.source.id
    editor.value.setModel(model.value)
    return
  }

  if (model.value.getLanguageId() !== nextLanguage) {
    monaco.editor.setModelLanguage(model.value, nextLanguage)
  }

  if (model.value.getValue() !== nextContent) {
    model.value.setValue(nextContent)
  }
}

const ensureEditor = async () => {
  if (editor.value || !editorRef.value) {
    return
  }

  applyTheme()

  editor.value = monaco.editor.create(editorRef.value, {
    readOnly: true,
    domReadOnly: true,
    automaticLayout: false,
    wordWrap: 'on',
    wrappingIndent: 'same',
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    lineNumbers: 'on',
    renderLineHighlight: 'none',
    contextmenu: false,
    fontFamily: uiSettingsStore.formattedCodeFontFamily,
    padding: {
      top: 12,
      bottom: 12
    }
  })

  syncModel()
  await nextTick()
  layoutEditor()
}

onMounted(() => {
  void ensureEditor()

  if (typeof ResizeObserver !== 'undefined' && editorRef.value) {
    resizeObserver = new ResizeObserver(() => {
      layoutEditor()
    })
    resizeObserver.observe(editorRef.value)
  }

  themeObserver = new MutationObserver(() => {
    applyTheme()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
})

watch(
  () => [props.source.id, props.source.content, props.source.language, props.source.type] as const,
  async () => {
    await ensureEditor()
    syncModel()
    await nextTick()
    layoutEditor()
  },
  {
    immediate: true,
    flush: 'post'
  }
)

watch(
  () => uiSettingsStore.formattedCodeFontFamily,
  (fontFamily) => {
    editor.value?.updateOptions({ fontFamily })
    layoutEditor()
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
  editor.value?.dispose()
  editor.value = null
  disposeModel()
})
</script>
