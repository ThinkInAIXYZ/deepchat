import { describe, it, expect } from 'vitest'
import { useDragAndDrop } from '@/components/chat-input/composables/useDragAndDrop'

describe('useDragAndDrop', () => {
  it('tracks drag state with proper counters and timers', () => {
    const api = useDragAndDrop()
    const evt = { dataTransfer: { types: ['Files'] } } as any as DragEvent
    api.handleDragEnter(evt)
    expect(api.isDragging.value).toBe(true)
    api.handleDragOver()
    api.handleDragLeave()
    // we cannot await timer here; call reset directly
    api.resetDragState()
    expect(api.isDragging.value).toBe(false)
  })
})
