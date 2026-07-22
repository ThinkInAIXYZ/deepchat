import { describe, expect, it } from 'vitest'
import type { MessageFile } from '@shared/types/agent-interface'
import {
  applyAcceptedComposerSubmission,
  createComposerTextDocument,
  type ComposerSessionDraft,
  type ComposerSubmissionSnapshot
} from '@/features/chat-page/model/composerDraftState'

const image = (name = 'scan.png'): MessageFile => ({
  name,
  path: `/tmp/${name}`,
  mimeType: 'image/png',
  requestedRepresentation: 'auto'
})

const documentWithFiles = (text: string, files: MessageFile[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        ...files.map((file) => ({
          type: 'fileAttachment',
          attrs: {
            fileName: file.name,
            filePath: file.path,
            mimeType: file.mimeType,
            requestedRepresentation: file.requestedRepresentation
          }
        }))
      ]
    }
  ]
})

describe('composerDraftState', () => {
  it('subtracts submitted duplicate attachments without deleting newer files', () => {
    const duplicate = image()
    const newer = image('new.png')
    const document = documentWithFiles('new draft', [duplicate, newer, duplicate])
    const current: ComposerSessionDraft = {
      revision: 7,
      rawMessage: 'new draft',
      files: [duplicate, newer, duplicate],
      activeSkills: ['review'],
      document
    }
    const submitted: ComposerSubmissionSnapshot = {
      revision: 3,
      rawMessage: 'old draft',
      files: [duplicate, duplicate],
      activeSkills: [],
      document: documentWithFiles('old draft', [duplicate, duplicate]),
      inlineItems: [],
      clearText: true
    }

    const next = applyAcceptedComposerSubmission(current, submitted)

    expect(next.rawMessage).toBe('new draft')
    expect(next.files).toEqual([newer])
    expect(JSON.stringify(next.document)).not.toContain('scan.png')
    expect(JSON.stringify(next.document)).toContain('new.png')
    expect(next.activeSkills).toEqual(['review'])
  })

  it('clears unchanged text and document while preserving unsent attachments', () => {
    const sent = image()
    const rejected = image('rejected.png')
    const document = documentWithFiles('read this', [sent, rejected])
    const current: ComposerSessionDraft = {
      revision: 4,
      rawMessage: 'read this',
      files: [sent, rejected],
      activeSkills: ['ocr'],
      document
    }
    const submitted: ComposerSubmissionSnapshot = {
      revision: 4,
      rawMessage: 'read this',
      files: [sent],
      activeSkills: ['ocr'],
      document,
      inlineItems: [],
      clearText: true
    }

    const next = applyAcceptedComposerSubmission(current, submitted)

    expect(next.rawMessage).toBe('')
    expect(next.files).toEqual([rejected])
    expect(next.activeSkills).toEqual([])
    expect(JSON.stringify(next.document)).toContain('rejected.png')
    expect(JSON.stringify(next.document)).not.toContain('read this')
  })

  it('treats an edit-and-revert revision as newer than the submitted snapshot', () => {
    const current: ComposerSessionDraft = {
      revision: 6,
      rawMessage: 'same text',
      files: [],
      activeSkills: [],
      document: createComposerTextDocument('same text')
    }
    const submitted: ComposerSubmissionSnapshot = {
      ...current,
      revision: 5,
      inlineItems: [],
      clearText: true
    }

    expect(applyAcceptedComposerSubmission(current, submitted).rawMessage).toBe('same text')
  })
})
