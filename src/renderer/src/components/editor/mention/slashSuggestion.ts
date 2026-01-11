import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import { Ref, ref } from 'vue'

import MentionList from './MentionList.vue'
import { CategorizedData } from './suggestion'

/**
 * Slash mention data - populated by useSlashMentionData composable
 * Contains: skills, prompts, tools
 */
export const slashMentionData: Ref<CategorizedData[]> = ref([])

/**
 * Track if a slash mention item was selected
 */
export const slashMentionSelected = ref(false)

/**
 * Callback for when a skill is selected via slash mention
 * This will be set by the ChatInput component to activate the skill
 */
let skillActivationHandler: ((skillName: string) => Promise<void>) | null = null

export const setSkillActivationHandler = (handler: typeof skillActivationHandler) => {
  skillActivationHandler = handler
}

export const getSkillActivationHandler = () => skillActivationHandler

/**
 * Slash suggestion configuration for TipTap Mention extension
 * Triggers on '/' character and shows skills, prompts, and tools
 */
export default {
  char: '/',
  allowedPrefixes: null, // Allow / after any character

  items: ({ query }) => {
    // Filter slash mention data by query
    let items: CategorizedData[] = []

    if (query) {
      // Search by label
      for (const item of slashMentionData.value) {
        if (item.label.toLowerCase().includes(query.toLowerCase())) {
          items.push(item)
        }
      }
      items = items.slice(0, 10)
    } else {
      // No query - return all items (limited)
      items = slashMentionData.value.slice(0, 10)
    }

    // Sort: skills first, then prompts, then tools
    const categoryOrder = { skills: 0, prompts: 1, tools: 2 }
    items.sort((a, b) => {
      const orderA = categoryOrder[a.category as keyof typeof categoryOrder] ?? 99
      const orderB = categoryOrder[b.category as keyof typeof categoryOrder] ?? 99
      return orderA - orderB
    })

    return items
  },

  render: () => {
    let component
    let popup

    return {
      onStart: (props) => {
        component = new VueRenderer(MentionList, {
          props: {
            ...props,
            query: props.query
          },
          editor: props.editor
        })

        if (!props.clientRect) {
          return
        }

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'top-start',
          zIndex: 90
        })
      },

      onUpdate(props) {
        component.updateProps({
          ...props,
          query: props.query
        })

        if (!props.clientRect || !popup?.[0]) {
          return
        }

        popup[0].setProps({
          getReferenceClientRect: props.clientRect
        })
      },

      onKeyDown(props) {
        if (!popup?.[0]) {
          return false
        }

        if (props.event.key === 'Escape') {
          popup[0].hide()
          return true
        }

        // Let the component handle the key event first
        const handled = component.ref?.onKeyDown(props)

        // If Enter is pressed and was handled by the menu, mark as selected
        // and return true to prevent the event from propagating to the editor
        if (props.event.key === 'Enter' && handled) {
          slashMentionSelected.value = true
          // Reset after a short delay
          setTimeout(() => {
            slashMentionSelected.value = false
          }, 300)
          return true // Prevent Enter from triggering send
        }

        return handled
      },

      onExit() {
        if (popup?.[0]) {
          popup[0].destroy()
        }
        component.destroy()
      }
    }
  }
}
