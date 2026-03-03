<template>
  <div
    class="w-full max-w-2xl rounded-xl border bg-card/30 backdrop-blur-lg shadow-sm overflow-hidden"
  >
    <div class="chat-input-editor px-4 pt-4 pb-2 text-sm" @keydown="handleKeydown">
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
import { useChatInputMentions } from './composables/useChatInputMentions'
import CommandInputDialog from './mentions/CommandInputDialog.vue'

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
  }>(),
  {
    modelValue: '',
    placeholder: 'Ask DeepChat anything, @ to mention files, / for commands',
    sessionId: null,
    workspacePath: null,
    isAcpSession: false,
    submitDisabled: false
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  'command-submit': [command: string]
  'pending-skills-change': [skills: string[]]
}>()

const isComposing = ref(false)
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
