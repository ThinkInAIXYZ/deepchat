// === Vue Core ===
import { ref, onUnmounted } from 'vue'

/**
 * Composable for managing drag and drop state
 * Handles drag enter/over/leave events with proper counter management
 */
export function useDragAndDrop() {
  // === Local State ===
  const isDragging = ref(false)
  const dragCounter = ref(0)
  let dragLeaveTimer: number | null = null

  // === Public Methods ===
  /**
   * Handle drag enter event
   */
  const handleDragEnter = (e: DragEvent) => {
    dragCounter.value++

    // Check if the dragged item contains files
    if (e.dataTransfer?.types.includes('Files')) {
      isDragging.value = true
    }
  }

  /**
   * Handle drag over event (prevent default to allow drop)
   */
  const handleDragOver = (e: DragEvent) => {
    // Prevent default to allow drop events
    e.preventDefault()
    e.stopPropagation()

    // Clear any pending leave timer to prevent flickering
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
  }

  /**
   * Handle drag leave event with debounce to prevent flickering
   */
  const handleDragLeave = () => {
    dragCounter.value--

    // Only hide drag state when counter reaches zero, with small delay to prevent flickering
    if (dragCounter.value <= 0) {
      if (dragLeaveTimer) clearTimeout(dragLeaveTimer)

      dragLeaveTimer = window.setTimeout(() => {
        if (dragCounter.value <= 0) {
          isDragging.value = false
          dragCounter.value = 0
        }
        dragLeaveTimer = null
      }, 50)
    }
  }

  /**
   * Reset drag state (call after drop)
   */
  const resetDragState = () => {
    isDragging.value = false
    dragCounter.value = 0

    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
  }

  // === Lifecycle Hooks ===
  onUnmounted(() => {
    // Clean up timer on unmount
    if (dragLeaveTimer) {
      clearTimeout(dragLeaveTimer)
      dragLeaveTimer = null
    }
  })

  // === Return Public API ===
  return {
    // State (readonly via computed would be ideal, but refs work for simple cases)
    isDragging,

    // Methods
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    resetDragState
  }
}
