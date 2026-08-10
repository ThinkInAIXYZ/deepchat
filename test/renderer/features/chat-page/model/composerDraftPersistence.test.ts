import { describe, expect, it, vi } from 'vitest'
import {
  clearComposerDraftFromStorage,
  loadComposerDraftFromStorage,
  saveComposerDraftToStorage
} from '@/features/chat-page/model/composerDraftPersistence'
import { createEmptyComposerDraft } from '@/features/chat-page/model/composerDraftState'

function createDraft(rawMessage = 'hello') {
  return {
    revision: 3,
    rawMessage,
    files: [],
    activeSkills: [],
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: rawMessage }] }]
    }
  }
}

describe('composerDraftPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a draft through localStorage', () => {
    const draft = createDraft('draft text')

    saveComposerDraftToStorage('s1', draft)

    expect(loadComposerDraftFromStorage('s1')).toEqual(draft)
  })

  it('does not store empty drafts and clears an existing key', () => {
    saveComposerDraftToStorage('s1', createDraft('filled'))
    saveComposerDraftToStorage('s1', createEmptyComposerDraft())

    expect(loadComposerDraftFromStorage('s1')).toBeNull()
    expect(loadComposerDraftFromStorage('s1')).toBeNull()
  })

  it('treats corrupted or malformed payloads as absent', () => {
    localStorage.setItem('deepchat.composerDraft.v1.s1', 'not-json{')
    expect(loadComposerDraftFromStorage('s1')).toBeNull()

    localStorage.setItem(
      'deepchat.composerDraft.v1.s2',
      JSON.stringify({ rawMessage: 'missing fields' })
    )
    expect(loadComposerDraftFromStorage('s2')).toBeNull()
  })

  it('rejects malformed nested draft fields', () => {
    const invalidPayloads = [
      { ...createDraft(), files: [null] },
      { ...createDraft(), files: [{ name: 'missing path' }] },
      { ...createDraft(), files: [{ name: 'a', path: 'a', pdfTextCoverage: {} }] },
      { ...createDraft(), activeSkills: ['valid', 123] },
      { ...createDraft(), activeSkills: [''] },
      { ...createDraft(), document: { type: 'doc', content: [null] } },
      { ...createDraft(), document: { type: 'doc', attrs: [] } }
    ]

    invalidPayloads.forEach((payload, index) => {
      localStorage.setItem(`deepchat.composerDraft.v1.invalid-${index}`, JSON.stringify(payload))
      expect(loadComposerDraftFromStorage(`invalid-${index}`)).toBeNull()
    })
  })

  it('returns null when no window storage is available', () => {
    const { window } = globalThis
    vi.stubGlobal('window', undefined)
    try {
      expect(loadComposerDraftFromStorage('s1')).toBeNull()
      expect(() => saveComposerDraftToStorage('s1', createDraft())).not.toThrow()
      expect(() => clearComposerDraftFromStorage('s1')).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
      if (window) globalThis.window = window
    }
  })

  it('ignores localStorage getter failures', () => {
    const { window } = globalThis
    vi.stubGlobal(
      'window',
      Object.defineProperty({}, 'localStorage', {
        get() {
          throw new Error('storage blocked')
        }
      })
    )
    try {
      expect(loadComposerDraftFromStorage('s1')).toBeNull()
      expect(() => saveComposerDraftToStorage('s1', createDraft())).not.toThrow()
      expect(() => clearComposerDraftFromStorage('s1')).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
      if (window) globalThis.window = window
    }
  })

  it('explicitly clears a stored draft', () => {
    saveComposerDraftToStorage('s1', createDraft())
    clearComposerDraftFromStorage('s1')
    expect(loadComposerDraftFromStorage('s1')).toBeNull()
  })
})
