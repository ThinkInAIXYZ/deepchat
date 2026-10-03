<template>
  <fieldset :disabled="!editable" class="contents">
    <EditorContent :editor="editor" class="reference-editor" />
  </fieldset>
</template>

<script setup lang="ts">
import type { UserMessageInlineItem } from '@shared/types/agent-interface'
import { Editor as VueEditor, EditorContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { onBeforeUnmount, watch } from 'vue'
import { createComposerTextDocument } from '@/features/chat-page/model/composerDraftState'
import { serializeComposerDocument } from '@/features/chat-page/model/composerDocumentSerialization'
import { FileAttachment } from './nodes/fileAttachment'
import { FileReference } from './nodes/fileReference'
import { SessionReference } from './nodes/sessionReference'
import { SkillChip } from './nodes/skillChip'

const props = withDefaults(
  defineProps<{
    text: string
    inlineItems?: UserMessageInlineItem[]
    ariaLabel: string
    editable?: boolean
  }>(),
  { editable: true }
)

const emit = defineEmits<{ save: []; cancel: []; contentChange: [hasContent: boolean] }>()

const editor = new VueEditor({
  editable: props.editable,
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    HardBreak,
    SkillChip,
    FileAttachment,
    FileReference,
    SessionReference
  ],
  content: createComposerTextDocument(props.text, props.inlineItems),
  onUpdate: ({ editor }) => {
    const value = serializeComposerDocument(editor.getJSON())
    emit(
      'contentChange',
      Boolean(value.text.trim() || value.inlineItems.some((item) => item.type === 'session'))
    )
  },
  editorProps: {
    handleKeyDown: (view, event) => {
      if (!props.editable) return false
      if (event.isComposing || event.keyCode === 229 || view.composing) return false
      if (event.key === 'Escape') {
        emit('cancel')
        return true
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        emit('save')
        return true
      }
      return false
    },
    attributes: {
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': props.ariaLabel,
      class:
        'min-h-[88px] max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none'
    }
  }
})

function getValue() {
  return serializeComposerDocument(editor.getJSON())
}

function focus() {
  editor.commands.focus('end')
}

defineExpose({ getValue, focus })
watch(
  () => props.editable,
  (editable) => editor.setEditable(editable),
  { flush: 'sync' }
)
onBeforeUnmount(() => editor.destroy())
</script>
