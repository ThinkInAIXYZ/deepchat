import TipTMention from '@tiptap/extension-mention'

/**
 * SlashMention extension for TipTap editor
 *
 * This extension handles the `/` trigger for skills, prompts, and tools.
 * It coexists with the regular Mention extension (`@` trigger) by using
 * a unique node name 'slashMention'.
 *
 * The extension adds custom attributes:
 * - category: identifies the type (skills, prompts, tools)
 * - content: stores additional metadata for prompts
 * - trigger: stores the trigger character used ('/')
 */
export const SlashMention = TipTMention.extend({
  name: 'slashMention',

  addOptions() {
    return {
      ...this.parent?.()
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),

      category: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-category'),
        renderHTML: (attributes) => {
          if (!attributes.category) {
            return {}
          }
          return {
            'data-category': attributes.category
          }
        }
      },

      content: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-content'),
        renderHTML: (attributes) => {
          if (!attributes.content) {
            return {}
          }
          return {
            'data-content': attributes.content
          }
        }
      },

      trigger: {
        default: '/',
        parseHTML: (element) => element.getAttribute('data-trigger') || '/',
        renderHTML: (attributes) => {
          return {
            'data-trigger': attributes.trigger || '/'
          }
        }
      }
    }
  }
})
