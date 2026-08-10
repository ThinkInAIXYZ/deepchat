import type { JSONContent } from '@tiptap/core'
import type { MessageFile } from '@shared/types/agent-interface'
import type { ComposerSessionDraft } from './composerDraftState'
import { isComposerDraftEmpty } from './composerDraftState'

/**
 * Per-session composer draft persistence. The draft (typed text, attachments, active skills and the
 * TipTap document) is kept in memory while the app runs so switching sessions restores it instantly,
 * and mirrored to localStorage so an app restart does not lose it. Empty drafts are never written and
 * remove any previously stored value.
 */
const COMPOSER_DRAFT_STORAGE_PREFIX = 'deepchat.composerDraft.v1.'
const DRAFT_PERSISTENCE_DEBOUNCE_MS = 400

function storageKey(sessionId: string): string {
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${sessionId}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function isJsonContent(value: unknown): value is JSONContent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }
  if (value.content !== undefined) {
    if (!Array.isArray(value.content) || !value.content.every(isJsonContent)) {
      return false
    }
  }
  if (value.text !== undefined && typeof value.text !== 'string') {
    return false
  }
  return value.attrs === undefined || isRecord(value.attrs)
}

function hasValidPdfTextCoverage(value: Record<string, unknown>): boolean {
  if (value.pdfTextCoverage === undefined) {
    return true
  }
  const coverage = value.pdfTextCoverage
  return (
    isRecord(coverage) &&
    typeof coverage.routingRevision === 'string' &&
    typeof coverage.pageCount === 'number' &&
    typeof coverage.substantivePageCount === 'number' &&
    typeof coverage.lowTextPageCount === 'number' &&
    Array.isArray(coverage.lowTextPageSamples) &&
    coverage.lowTextPageSamples.every((item) => typeof item === 'number') &&
    typeof coverage.hasEmbeddedText === 'boolean'
  )
}

function isMessageFile(value: unknown): value is MessageFile {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.path !== 'string') {
    return false
  }
  return (
    (value.type === undefined || typeof value.type === 'string') &&
    (value.size === undefined || typeof value.size === 'number') &&
    (value.content === undefined || typeof value.content === 'string') &&
    (value.mimeType === undefined || typeof value.mimeType === 'string') &&
    (value.token === undefined || typeof value.token === 'number') &&
    (value.thumbnail === undefined || typeof value.thumbnail === 'string') &&
    (value.requestedRepresentation === undefined ||
      typeof value.requestedRepresentation === 'string') &&
    (value.resolvedRepresentation === undefined || isRecord(value.resolvedRepresentation)) &&
    (value.metadata === undefined || isRecord(value.metadata)) &&
    hasValidPdfTextCoverage(value)
  )
}

function parseComposerDraft(value: unknown): ComposerSessionDraft | null {
  if (
    !isRecord(value) ||
    typeof value.rawMessage !== 'string' ||
    typeof value.revision !== 'number' ||
    !Array.isArray(value.files) ||
    !value.files.every(isMessageFile) ||
    !isStringArray(value.activeSkills) ||
    !isJsonContent(value.document)
  ) {
    return null
  }

  return {
    revision: value.revision,
    rawMessage: value.rawMessage,
    files: value.files,
    activeSkills: value.activeSkills,
    document: value.document
  }
}

export function loadComposerDraftFromStorage(sessionId: string): ComposerSessionDraft | null {
  const storage = getStorage()
  if (!storage || !sessionId) {
    return null
  }
  try {
    const raw = storage.getItem(storageKey(sessionId))
    if (!raw) {
      return null
    }
    const draft = parseComposerDraft(JSON.parse(raw))
    if (!draft || isComposerDraftEmpty(draft)) {
      return null
    }
    return draft
  } catch {
    // Corrupted or unreadable draft payloads are treated as absent; the user just gets a clean box.
    return null
  }
}

export function saveComposerDraftToStorage(sessionId: string, draft: ComposerSessionDraft): void {
  const storage = getStorage()
  if (!storage || !sessionId) {
    return
  }
  try {
    if (isComposerDraftEmpty(draft)) {
      storage.removeItem(storageKey(sessionId))
      return
    }
    storage.setItem(storageKey(sessionId), JSON.stringify(draft))
  } catch {
    // Storage can be unavailable (private mode, quota). Draft persistence is best-effort.
  }
}

export function clearComposerDraftFromStorage(sessionId: string): void {
  const storage = getStorage()
  if (!storage || !sessionId) {
    return
  }
  try {
    storage.removeItem(storageKey(sessionId))
  } catch {
    // Ignore storage failures; the in-memory draft still works for this run.
  }
}

export { DRAFT_PERSISTENCE_DEBOUNCE_MS }
