// === Vue Core ===
import { ref, computed } from 'vue'

// === Types ===
import type { Editor } from '@tiptap/vue-3'

// === Utils ===
import { searchHistory } from '@/lib/searchHistory'

/**
 * Composable for managing input history placeholder and navigation
 * Handles arrow key navigation through previous inputs and placeholder display
 */
export function useInputHistory(editor: Editor | null, t: (key: string) => string) {
  // === Local State ===
  const currentHistoryPlaceholder = ref('')
  const showHistoryPlaceholder = ref(false)
  let editorInstance: Editor | null = editor

  // === Computed ===
  const dynamicPlaceholder = computed(() => {
    if (currentHistoryPlaceholder.value) {
      return `${currentHistoryPlaceholder.value} ${t('chat.input.historyPlaceholder')}`
    }
    return t('chat.input.placeholder')
  })

  // === Internal Helper Functions ===
  /**
   * Force update TipTap editor's placeholder display
   */
  const updatePlaceholder = () => {
    if (!editorInstance) return
    const { state } = editorInstance
    editorInstance.view.updateState(state)
  }

  /**
   * Set editor instance (for delayed initialization)
   */
  const setEditor = (newEditor: Editor) => {
    editorInstance = newEditor
  }

  // === Public Methods ===
  /**
   * Set history placeholder text
   */
  const setHistoryPlaceholder = (text: string) => {
    currentHistoryPlaceholder.value = text
    showHistoryPlaceholder.value = true
    updatePlaceholder()
  }

  /**
   * Clear history placeholder
   */
  const clearHistoryPlaceholder = () => {
    currentHistoryPlaceholder.value = ''
    showHistoryPlaceholder.value = false
    updatePlaceholder()
    searchHistory.resetIndex()
  }

  /**
   * Handle arrow key navigation for history
   * @returns true if handled, false otherwise
   */
  const handleArrowKey = (direction: 'up' | 'down', currentContent: string): boolean => {
    if (currentContent.trim()) {
      return false // Only work when input is empty
    }

    if (direction === 'up') {
      const previousSearch = searchHistory.getPrevious()
      if (previousSearch !== null) {
        setHistoryPlaceholder(previousSearch)
        return true
      }
    } else if (direction === 'down') {
      const nextSearch = searchHistory.getNext()
      if (nextSearch !== null) {
        setHistoryPlaceholder(nextSearch)
        return true
      } else {
        // At the end of history, clear placeholder and reset index to end
        // so that next up arrow starts from the latest entry
        currentHistoryPlaceholder.value = ''
        showHistoryPlaceholder.value = false
        updatePlaceholder()
        searchHistory.resetIndex()
        return true
      }
    }

    return false
  }

  /**
   * Confirm and fill history placeholder content
   */
  const confirmHistoryPlaceholder = () => {
    if (currentHistoryPlaceholder.value && editorInstance) {
      editorInstance.commands.setContent(currentHistoryPlaceholder.value)
      clearHistoryPlaceholder()
      return true
    }
    return false
  }

  /**
   * Add text to search history
   */
  const addToHistory = (text: string) => {
    searchHistory.addSearch(text)
  }

  /**
   * Initialize history system
   */
  const initHistory = () => {
    searchHistory.resetIndex()
  }

  // === Return Public API ===
  return {
    // State (readonly)
    currentHistoryPlaceholder: computed(() => currentHistoryPlaceholder.value),
    showHistoryPlaceholder: computed(() => showHistoryPlaceholder.value),
    dynamicPlaceholder,

    // Methods
    setEditor,
    setHistoryPlaceholder,
    clearHistoryPlaceholder,
    handleArrowKey,
    confirmHistoryPlaceholder,
    addToHistory,
    initHistory,
    updatePlaceholder
  }
}
