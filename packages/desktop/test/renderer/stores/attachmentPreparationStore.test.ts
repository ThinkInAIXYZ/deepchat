import { describe, expect, it, vi } from 'vitest'

describe('attachmentPreparationStore', () => {
  it('keeps an isolated one-shot recovery bound to the created session', async () => {
    vi.resetModules()
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAttachmentPreparationStore } = await import('@/stores/ui/attachmentPreparation')
    const store = useAttachmentPreparationStore()
    const input = {
      text: 'read this',
      files: [
        {
          name: 'scan.png',
          path: '/tmp/scan.png',
          mimeType: 'image/png',
          metadata: { fileName: 'scan.png' }
        }
      ],
      activeSkills: ['ocr-skill']
    }
    const summary = {
      status: 'needs_user_action' as const,
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' as const }],
      suggestedActions: ['retry' as const]
    }

    store.stageInitialDraftRecovery({ sessionId: 's1', input, summary })
    input.files[0].metadata.fileName = 'mutated.png'
    input.activeSkills[0] = 'mutated-skill'
    summary.issues[0].attachmentIndex = 7

    expect(store.consumeInitialDraftRecovery('s2')).toBeNull()
    expect(store.consumeInitialDraftRecovery('s1')).toEqual({
      sessionId: 's1',
      input: {
        text: 'read this',
        files: [
          {
            name: 'scan.png',
            path: '/tmp/scan.png',
            mimeType: 'image/png',
            metadata: { fileName: 'scan.png' }
          }
        ],
        activeSkills: ['ocr-skill']
      },
      summary: {
        status: 'needs_user_action',
        issues: [{ attachmentIndex: 0, reason: 'ocr_empty' }],
        suggestedActions: ['retry']
      }
    })
    expect(store.consumeInitialDraftRecovery('s1')).toBeNull()
  })

  it('keeps independent recoveries and replaces only the matching session', async () => {
    vi.resetModules()
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAttachmentPreparationStore } = await import('@/stores/ui/attachmentPreparation')
    const store = useAttachmentPreparationStore()
    const summary = {
      status: 'needs_user_action' as const,
      issues: [],
      suggestedActions: ['retry' as const]
    }

    store.stageInitialDraftRecovery({ sessionId: 's1', input: { text: 'old' }, summary })
    store.stageInitialDraftRecovery({ sessionId: 's2', input: { text: 'second' }, summary })
    store.stageInitialDraftRecovery({ sessionId: 's1', input: { text: 'new' }, summary })

    expect(store.consumeInitialDraftRecovery('s1')).toMatchObject({
      input: { text: 'new' }
    })
    expect(store.consumeInitialDraftRecovery('s2')).toMatchObject({
      input: { text: 'second' }
    })
    expect(store.consumeInitialDraftRecovery('s1')).toBeNull()
    expect(store.consumeInitialDraftRecovery('s2')).toBeNull()
  })
})
