import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CommandFormView from './CommandFormView.vue'

export const CommandForm = Node.create({
  name: 'commandForm',

  group: 'block',

  atom: true,

  selectable: false,

  draggable: false,

  addAttributes() {
    return {
      mode: {
        default: 'command'
      },
      commandName: {
        default: ''
      },
      description: {
        default: ''
      },
      confirmText: {
        default: ''
      },
      fields: {
        default: '[]'
      },
      pendingCommand: {
        default: null
      },
      pendingPrompt: {
        default: null
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-command-form]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-command-form': '',
        class: 'my-2 rounded-lg border border-border bg-card p-3 shadow-sm'
      }),
      ['div', { class: 'text-sm font-medium' }, 'Command Form']
    ]
  },

  renderText() {
    return ''
  },

  addNodeView() {
    return VueNodeViewRenderer(CommandFormView)
  }
})
