import { describe, it, expect, vi } from 'vitest'
import { useInputHistory } from '@/components/chat-input/composables/useInputHistory'

// mock search history module with a simple ring buffer
let entries = ['alpha', 'beta', 'gamma']
let idx = entries.length
vi.mock('@/lib/searchHistory', () => ({
  searchHistory: {
    addSearch: (v: string) => {
      entries.push(v)
      idx = entries.length
    },
    resetIndex: () => {
      idx = entries.length
    },
    getPrevious: () => {
      if (idx > 0) {
        idx--
        return entries[idx]
      }
      return null
    },
    getNext: () => {
      if (idx < entries.length - 1) {
        idx++
        return entries[idx]
      }
      return null
    }
  }
}))

const fakeEditor = () =>
  ({
    commands: {
      setContent: vi.fn()
    },
    view: {
      updateState: vi.fn()
    }
  }) as any

describe('useInputHistory', () => {
  it('manages placeholder and confirms fill', () => {
    const t = (k: string) => k
    const ed = fakeEditor()
    const api = useInputHistory(ed, t)

    expect(api.dynamicPlaceholder.value).toBe('chat.input.placeholder')
    api.setHistoryPlaceholder('recent text')
    expect(api.dynamicPlaceholder.value.includes('recent text')).toBe(true)

    const ok = api.confirmHistoryPlaceholder()
    expect(ok).toBe(true)
    expect(ed.commands.setContent).toHaveBeenCalledWith('recent text')
  })

  it('navigates entries with arrows only when empty', () => {
    const t = (k: string) => k
    const ed = fakeEditor()
    const api = useInputHistory(ed, t)

    let handled = api.handleArrowKey('up', '')
    expect(handled).toBe(true)
    handled = api.handleArrowKey('down', '')
    expect(handled).toBe(true)

    // content not empty -> do nothing
    expect(api.handleArrowKey('up', 'has text')).toBe(false)
  })
})
