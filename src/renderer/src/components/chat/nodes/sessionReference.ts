import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import SessionReferenceView from './SessionReferenceView.vue'

export const SessionReference = Node.create({
  name: 'sessionReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return Object.fromEntries(
      ['sessionId', 'title', 'projectDir', 'tapeIncarnationId'].map((name) => [
        name,
        {
          default: name === 'projectDir' ? null : '',
          parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
          renderHTML: (attrs: Record<string, unknown>) => ({ [`data-${name}`]: attrs[name] })
        }
      ])
    )
  },
  parseHTML() {
    return [{ tag: 'span[data-session-reference]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-session-reference': '' })]
  },
  renderText() {
    return ''
  },
  addNodeView() {
    return VueNodeViewRenderer(SessionReferenceView)
  }
})
