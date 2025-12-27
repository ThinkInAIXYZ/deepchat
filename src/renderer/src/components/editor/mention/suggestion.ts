import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import { Ref, ref } from 'vue'

import MentionList from './MentionList.vue'
import { PromptListEntry, ResourceListEntry } from '@shared/presenter'

// Define the type for categorized data
export interface CategorizedData {
  label: string
  icon?: string
  id?: string
  type: string
  category?: string
  description?: string
  mcpEntry?: ResourceListEntry | PromptListEntry
  content?: string
}

// Sample categorized items
const categorizedData: CategorizedData[] = [
  { label: 'context', icon: 'lucide:quote', type: 'category' },
  { label: 'files', icon: 'lucide:files', type: 'category' },
  { label: 'resources', icon: 'lucide:swatch-book', type: 'category' },
  { label: 'tools', icon: 'lucide:hammer', type: 'category' },
  { label: 'prompts', icon: 'lucide:message-square-quote', type: 'category' }
]

// Create a ref to track mention selections
export const mentionSelected = ref(false)
export const mentionData: Ref<CategorizedData[]> = ref(categorizedData)

export type WorkspaceMentionHandler = {
  searchWorkspaceFiles: (query: string) => void
  workspaceFileResults: Ref<CategorizedData[]>
  isEnabled: Ref<boolean>
}

let workspaceMentionHandler: WorkspaceMentionHandler | null = null

export const setWorkspaceMention = (handler: WorkspaceMentionHandler | null) => {
  workspaceMentionHandler = handler
}

// 存储文件处理回调函数
let promptFilesHandler:
  | ((
      files: Array<{
        id: string
        name: string
        type: string
        size: number
        path: string
        description?: string
        content?: string
        createdAt: number
      }>
    ) => Promise<void>)
  | null = null

// 设置文件处理回调函数
export const setPromptFilesHandler = (handler: typeof promptFilesHandler) => {
  promptFilesHandler = handler
}

// 获取文件处理回调函数
export const getPromptFilesHandler = () => promptFilesHandler

export default {
  char: '@',
  allowedPrefixes: null, // null means allow @ after any character
  items: ({ query }) => {
    // Note: TipTap mention passes query WITHOUT the trigger character (@)
    // So if user types "@", query is ""
    // If user types "@p", query is "p"

    // Collect workspace results if enabled
    let workspaceResults: CategorizedData[] = []
    if (workspaceMentionHandler?.isEnabled.value) {
      workspaceMentionHandler.searchWorkspaceFiles(query)
      workspaceResults = workspaceMentionHandler.workspaceFileResults.value
    }

    // Collect other mention data (prompts, tools, files, resources)
    let otherItems: CategorizedData[] = []
    if (query) {
      // Search across all categories
      for (const item of mentionData.value) {
        if (item.label.toLowerCase().includes(query.toLowerCase())) {
          otherItems.push(item)
        }
      }
      otherItems = otherItems.slice(0, 5)
    } else {
      // If no query, return all mention data
      otherItems = mentionData.value
    }

    // Combine workspace results with other mention data
    // Workspace results come first, then other mention data
    const combined = [...workspaceResults, ...otherItems]
    return combined
  },

  render: () => {
    let component
    let popup

    return {
      onStart: (props) => {
        component = new VueRenderer(MentionList, {
          // using vue 2:
          // parent: this,
          // propsData: props,
          // using vue 3:
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

        // If Enter is pressed on a mention item
        if (props.event.key === 'Enter') {
          mentionSelected.value = true
          // Reset after a short delay
          setTimeout(() => {
            mentionSelected.value = false
          }, 300)
        }

        return component.ref?.onKeyDown(props)
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
