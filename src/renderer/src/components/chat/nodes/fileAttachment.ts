import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { normalizeAttachmentRepresentationPreference } from '@shared/utils/attachmentRepresentation'
import FileAttachmentView from './FileAttachmentView.vue'

export const FileAttachment = Node.create({
  name: 'fileAttachment',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      fileName: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-file-name'),
        renderHTML: (attrs) => ({
          'data-file-name': attrs.fileName
        })
      },
      filePath: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-file-path'),
        renderHTML: (attrs) => ({
          'data-file-path': attrs.filePath
        })
      },
      mimeType: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-mime-type'),
        renderHTML: (attrs) => ({
          'data-mime-type': attrs.mimeType
        })
      },
      requestedRepresentation: {
        default: 'auto',
        parseHTML: (el) =>
          normalizeAttachmentRepresentationPreference(
            el.getAttribute('data-requested-representation')
          ) ?? 'auto',
        renderHTML: (attrs) => ({
          'data-requested-representation': attrs.requestedRepresentation
        })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-file-attachment]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-file-attachment': '',
        class:
          'inline-flex items-center gap-1 rounded-md border border-muted-foreground/30 bg-muted/20 px-1.5 py-0.5 text-xs text-muted-foreground'
      })
    ]
  },

  renderText() {
    return ''
  },

  addNodeView() {
    return VueNodeViewRenderer(FileAttachmentView)
  }
})
