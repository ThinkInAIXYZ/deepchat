<template>
  <div
    class="w-full max-w-2xl rounded-xl border bg-card/30 backdrop-blur-lg shadow-sm overflow-hidden"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <input ref="fileInput" type="file" class="hidden" multiple @change="files.handleFileSelect" />

    <div v-if="files.selectedFiles.value.length > 0" class="flex flex-wrap gap-2 px-4 pt-3">
      <ChatAttachmentItem
        v-for="(file, index) in files.selectedFiles.value"
        :key="file.path || `${file.name}-${index}`"
        :file="file"
        removable
        @remove="files.deleteFile(index)"
      />
    </div>

    <div
      class="chat-input-editor px-4 pt-4 pb-2 text-sm"
      @keydown="handleKeydown"
      @paste.capture="onPaste"
    >
      <EditorContent
        :editor="editor"
        class="min-h-[80px]"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />
    </div>

    <slot name="toolbar" />

    <CommandInputDialog
      v-if="dialogState"
      :open="Boolean(dialogState)"
      :title="dialogState?.title || ''"
      :description="dialogState?.description"
      :confirm-text="dialogState?.confirmText"
      :fields="dialogState?.fields || []"
      @update:open="onDialogOpenChange"
      @submit="mentions.submitDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, ref, computed, onUnmounted } from 'vue'
import { Editor as VueEditor, EditorContent } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import { TextSelection } from '@tiptap/pm/state'
import type { MessageFile } from '@shared/chat'
import { useI18n } from 'vue-i18n'
import { useChatInputMentions } from './composables/useChatInputMentions'
import { useChatInputFiles } from './composables/useChatInputFiles'
import CommandInputDialog from './mentions/CommandInputDialog.vue'
import ChatAttachmentItem from './ChatAttachmentItem.vue'

const SlashMention = Mention.extend({
  name: 'slashMention'
})

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    sessionId?: string | null
    workspacePath?: string | null
    isAcpSession?: boolean
    submitDisabled?: boolean
    files?: MessageFile[]
  }>(),
  {
    modelValue: '',
    placeholder: 'Ask DeepChat anything, @ to mention files, / for commands',
    sessionId: null,
    workspacePath: null,
    isAcpSession: false,
    submitDisabled: false,
    files: () => []
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  'update:files': [files: MessageFile[]]
  'command-submit': [command: string]
  'pending-skills-change': [skills: string[]]
}>()

const isComposing = ref(false)
const fileInput = ref<HTMLInputElement>()
const { t } = useI18n()
let editorInstance: Editor | null = null
const getEditor = () => editorInstance

const mentions = useChatInputMentions({
  getEditor,
  workspacePath: computed(() => props.workspacePath),
  sessionId: computed(() => props.sessionId),
  isAcpSession: computed(() => props.isAcpSession),
  onCommandSubmit: (command) => emit('command-submit', command),
  onPendingSkillsChange: (skills) => emit('pending-skills-change', skills)
})
const dialogState = mentions.dialogState
const files = useChatInputFiles(
  fileInput,
  (_event, nextFiles) => {
    emit('update:files', [...nextFiles])
  },
  t
)

const sameFiles = (a: MessageFile[], b: MessageFile[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left.name !== right.name) return false
    if ((left.path || '') !== (right.path || '')) return false
    if ((left.mimeType || '') !== (right.mimeType || '')) return false
  }
  return true
}

const toEditorDoc = (text: string) => {
  const lines = text.replace(/\r/g, '').split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : []
    }))
  }
}

const getEditorText = (editor: Editor): string => {
  return editor.getText({ blockSeparator: '\n' })
}

const setCaretToEnd = (editor: Editor) => {
  const end = TextSelection.atEnd(editor.state.doc)
  editor.view.dispatch(editor.state.tr.setSelection(end))
}

const editor = new VueEditor({
  editorProps: {
    attributes: {
      class: 'outline-none min-h-[80px]'
    }
  },
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    Mention.configure({
      suggestion: mentions.atSuggestion as any,
      deleteTriggerWithBackspace: true
    }),
    SlashMention.configure({
      suggestion: mentions.slashSuggestion as any,
      deleteTriggerWithBackspace: true
    }),
    Placeholder.configure({
      placeholder: props.placeholder
    }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => this.editor.chain().setHardBreak().scrollIntoView().run()
        }
      }
    })
  ],
  content: toEditorDoc(props.modelValue || ''),
  onUpdate: ({ editor }) => {
    const text = getEditorText(editor)
    if (text !== (props.modelValue || '')) {
      emit('update:modelValue', text)
    }
  }
})

editorInstance = editor

watch(
  () => props.modelValue,
  (value) => {
    const next = value || ''
    const current = getEditorText(editor)
    if (next === current) {
      return
    }

    editor.commands.setContent(toEditorDoc(next), false)
    setCaretToEnd(editor)
  }
)

watch(
  () => props.files ?? [],
  (nextFiles) => {
    if (sameFiles(nextFiles, files.selectedFiles.value)) {
      return
    }
    files.selectedFiles.value = [...nextFiles]
  },
  { deep: true, immediate: true }
)

onUnmounted(() => {
  editor.destroy()
})

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) {
    return
  }

  if (mentions.isSuggestionMenuOpen.value || mentions.shouldSuppressSubmit()) {
    return
  }

  if (props.submitDisabled) {
    e.preventDefault()
    return
  }

  const isImeComposing = isComposing.value || e.isComposing || e.keyCode === 229
  if (isImeComposing) {
    return
  }

  e.preventDefault()
  emit('submit')
}

function onDialogOpenChange(open: boolean) {
  if (!open) {
    mentions.closeDialog()
  }
}

function onPaste(event: ClipboardEvent) {
  void files.handlePaste(event, true)
}

function onDrop(event: DragEvent) {
  if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
    return
  }
  void files.handleDrop(event.dataTransfer.files)
}

function triggerAttach() {
  files.openFilePicker()
}

defineExpose({
  triggerAttach
})
</script>

<style scoped>
:deep(.chat-input-editor .tiptap p.is-editor-empty:first-child::before) {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
