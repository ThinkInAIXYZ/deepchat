import type { JSONContent } from '@tiptap/core'
import type { MessageFile, UserMessageInlineItem } from '@shared/types/agent-interface'

export interface ComposerSessionDraft {
  revision: number
  rawMessage: string
  files: MessageFile[]
  activeSkills: string[]
  document: JSONContent
}

export interface ComposerSubmissionSnapshot {
  revision: number
  rawMessage: string
  files: MessageFile[]
  activeSkills: string[]
  document: JSONContent
  inlineItems: UserMessageInlineItem[]
  clearText: boolean
}

export function copyComposerFiles(files: MessageFile[]): MessageFile[] {
  return files.map((file) => ({
    ...file,
    ...(file.metadata ? { metadata: { ...file.metadata } } : {}),
    ...(file.pdfTextCoverage
      ? {
          pdfTextCoverage: {
            ...file.pdfTextCoverage,
            lowTextPageSamples: [...file.pdfTextCoverage.lowTextPageSamples]
          }
        }
      : {})
  }))
}

export function copyComposerDocument(document: JSONContent): JSONContent {
  return JSON.parse(JSON.stringify(document)) as JSONContent
}

export function createComposerTextDocument(text: string): JSONContent {
  const lines = text.replace(/\r/g, '').split('\n')
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {})
    }))
  }
}

export function createEmptyComposerDraft(revision = 0): ComposerSessionDraft {
  return {
    revision,
    rawMessage: '',
    files: [],
    activeSkills: [],
    document: createComposerTextDocument('')
  }
}

export function copyComposerDraft(draft: ComposerSessionDraft): ComposerSessionDraft {
  return {
    revision: draft.revision,
    rawMessage: draft.rawMessage,
    files: copyComposerFiles(draft.files),
    activeSkills: [...draft.activeSkills],
    document: copyComposerDocument(draft.document)
  }
}

export function composerDocumentsMatch(left: JSONContent, right: JSONContent): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function composerDraftFingerprint(draft: ComposerSessionDraft): string {
  return JSON.stringify({
    rawMessage: draft.rawMessage,
    files: draft.files.map(fileIdentity),
    activeSkills: draft.activeSkills,
    document: draft.document
  })
}

export function isComposerDraftEmpty(draft: ComposerSessionDraft): boolean {
  return (
    draft.rawMessage.length === 0 &&
    draft.files.length === 0 &&
    draft.activeSkills.length === 0 &&
    composerDocumentsMatch(draft.document, createComposerTextDocument(''))
  )
}

export function applyAcceptedComposerSubmission(
  current: ComposerSessionDraft,
  submitted: ComposerSubmissionSnapshot
): ComposerSessionDraft {
  const files = subtractFiles(current.files, submitted.files)
  const contentIsUnchanged =
    current.revision === submitted.revision &&
    current.rawMessage === submitted.rawMessage &&
    composerDocumentsMatch(current.document, submitted.document)

  if (!contentIsUnchanged) {
    return {
      ...copyComposerDraft(current),
      files,
      document: removeDocumentNodes(current.document, submitted.files, [])
    }
  }

  const activeSkills = subtractStrings(current.activeSkills, submitted.activeSkills)
  if (submitted.clearText) {
    return {
      revision: current.revision,
      rawMessage: '',
      files,
      activeSkills,
      document: createInlineOnlyDocument(files, activeSkills)
    }
  }

  return {
    revision: current.revision,
    rawMessage: current.rawMessage,
    files,
    activeSkills,
    document: removeDocumentNodes(current.document, submitted.files, submitted.activeSkills)
  }
}

export function retainComposerDocumentFiles(
  document: JSONContent,
  files: MessageFile[]
): JSONContent {
  const remaining = copyComposerFiles(files)
  return transformDocument(document, (node) => {
    if (node.type !== 'fileAttachment') return true
    const index = remaining.findIndex((file) => fileMatchesDocumentNode(file, node))
    if (index < 0) return false
    remaining.splice(index, 1)
    return true
  })
}

function fileIdentity(file: MessageFile | undefined) {
  return {
    name: file?.name ?? '',
    path: file?.path ?? '',
    mimeType: file?.mimeType ?? '',
    requestedRepresentation: file?.requestedRepresentation ?? 'auto'
  }
}

function fileMatches(left: MessageFile | undefined, right: MessageFile | undefined): boolean {
  if (!left || !right) return false
  const leftIdentity = fileIdentity(left)
  const rightIdentity = fileIdentity(right)
  return (
    leftIdentity.name === rightIdentity.name &&
    leftIdentity.path === rightIdentity.path &&
    leftIdentity.mimeType === rightIdentity.mimeType &&
    leftIdentity.requestedRepresentation === rightIdentity.requestedRepresentation
  )
}

function fileMatchesDocumentNode(file: MessageFile, node: JSONContent): boolean {
  const attrs = node.attrs ?? {}
  return (
    String(attrs.fileName ?? '') === file.name &&
    String(attrs.filePath ?? '') === (file.path || file.name) &&
    String(attrs.mimeType ?? '') === (file.mimeType ?? '') &&
    String(attrs.requestedRepresentation ?? 'auto') === (file.requestedRepresentation ?? 'auto')
  )
}

function subtractFiles(current: MessageFile[], submitted: MessageFile[]): MessageFile[] {
  const remaining = copyComposerFiles(current)
  for (const submittedFile of submitted) {
    const index = remaining.findIndex((file) => fileMatches(file, submittedFile))
    if (index >= 0) remaining.splice(index, 1)
  }
  return remaining
}

function subtractStrings(current: string[], submitted: string[]): string[] {
  const remaining = [...current]
  for (const submittedValue of submitted) {
    const index = remaining.indexOf(submittedValue)
    if (index >= 0) remaining.splice(index, 1)
  }
  return remaining
}

function removeDocumentNodes(
  document: JSONContent,
  files: MessageFile[],
  activeSkills: string[]
): JSONContent {
  const remainingFiles = copyComposerFiles(files)
  const remainingSkills = [...activeSkills]
  return transformDocument(document, (node) => {
    if (node.type === 'fileAttachment') {
      const index = remainingFiles.findIndex((file) => fileMatchesDocumentNode(file, node))
      if (index < 0) return true
      remainingFiles.splice(index, 1)
      return false
    }
    if (node.type === 'skillChip') {
      const index = remainingSkills.indexOf(String(node.attrs?.skillName ?? ''))
      if (index < 0) return true
      remainingSkills.splice(index, 1)
      return false
    }
    return true
  })
}

function transformDocument(
  document: JSONContent,
  keepNode: (node: JSONContent) => boolean
): JSONContent {
  const transform = (node: JSONContent): JSONContent | null => {
    if (!keepNode(node)) return null
    const content = node.content
      ?.map((child) => transform(child))
      .filter((child): child is JSONContent => child !== null)
    return {
      ...node,
      ...(content ? { content } : {})
    }
  }
  return transform(copyComposerDocument(document)) ?? createComposerTextDocument('')
}

function createInlineOnlyDocument(files: MessageFile[], activeSkills: string[]): JSONContent {
  const content: JSONContent[] = [
    ...files.map((file) => ({
      type: 'fileAttachment',
      attrs: {
        fileName: file.name,
        filePath: file.path || file.name,
        mimeType: file.mimeType ?? '',
        requestedRepresentation: file.requestedRepresentation ?? 'auto'
      }
    })),
    ...activeSkills.map((skillName) => ({
      type: 'skillChip',
      attrs: { skillName }
    }))
  ]
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        ...(content.length > 0 ? { content } : {})
      }
    ]
  }
}
