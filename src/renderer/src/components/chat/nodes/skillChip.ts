import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import SkillChipView from './SkillChipView.vue'

export const SkillChip = Node.create({
  name: 'skillChip',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      skillName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-skill-name'),
        renderHTML: (attrs) => ({
          'data-skill-name': attrs.skillName
        })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-skill-chip]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-skill-chip': '',
        class:
          'inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs text-primary'
      })
    ]
  },

  renderText() {
    return ''
  },

  addNodeView() {
    return VueNodeViewRenderer(SkillChipView)
  }
})
