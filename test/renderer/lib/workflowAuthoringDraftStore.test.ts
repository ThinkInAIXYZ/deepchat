import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES,
  deleteWorkflowAuthoringDraft,
  readWorkflowAuthoringDraft,
  saveWorkflowAuthoringDraft,
  type WorkflowAuthoringDraft
} from '@/lib/workflowAuthoringDraftStore'

const directoryPath = '/repo/.deepchat/workflows'
const createdSessionIds: string[] = []

afterEach(() => {
  for (const sessionId of createdSessionIds.splice(0)) {
    deleteWorkflowAuthoringDraft(sessionId, directoryPath)
  }
})

describe('workflowAuthoringDraftStore', () => {
  it('evicts the least recently used draft when its entry bound is exceeded', () => {
    for (let index = 0; index <= WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES; index += 1) {
      const sessionId = `entry-session-${index}`
      createdSessionIds.push(sessionId)
      expect(
        saveWorkflowAuthoringDraft(sessionId, directoryPath, createDraft(`source-${index}`))
      ).toBe(true)
    }

    expect(readWorkflowAuthoringDraft('entry-session-0', directoryPath)).toBeNull()
    expect(
      readWorkflowAuthoringDraft(
        `entry-session-${WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES}`,
        directoryPath
      )?.draftSource
    ).toBe(`source-${WORKFLOW_AUTHORING_DRAFT_MAX_ENTRIES}`)
  })

  it('also evicts old drafts when retained source and arguments exceed the byte budget', () => {
    const largeValue = 'x'.repeat(256 * 1024)
    for (let index = 0; index < 6; index += 1) {
      const sessionId = `byte-session-${index}`
      createdSessionIds.push(sessionId)
      expect(
        saveWorkflowAuthoringDraft(sessionId, directoryPath, {
          ...createDraft(largeValue),
          argsText: largeValue,
          document: {
            name: 'review',
            relativePath: '.deepchat/workflows/review.js',
            absolutePath: '/repo/.deepchat/workflows/review.js',
            sourceHash: 'd'.repeat(64),
            source: largeValue,
            byteLength: largeValue.length,
            updatedAt: 1
          }
        })
      ).toBe(true)
    }

    expect(readWorkflowAuthoringDraft('byte-session-0', directoryPath)).toBeNull()
    expect(readWorkflowAuthoringDraft('byte-session-5', directoryPath)).not.toBeNull()
  })
})

function createDraft(draftSource: string): WorkflowAuthoringDraft {
  return {
    selectedName: 'review',
    document: null,
    draftName: 'review',
    draftSource,
    argsText: '{}',
    agentIdsText: ''
  }
}
