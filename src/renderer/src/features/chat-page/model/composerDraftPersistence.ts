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

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadComposerDraftFromStorage(sessionId: string): ComposerSessionDraft | null {
  if (!hasStorage() || !sessionId) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<ComposerSessionDraft>
    if (
      !parsed ||
      typeof parsed.rawMessage !== 'string' ||
      typeof parsed.revision !== 'number' ||
      !parsed.document ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.activeSkills)
    ) {
      return null
    }
    const draft = parsed as ComposerSessionDraft
    if (isComposerDraftEmpty(draft)) {
      return null
    }
    return draft
  } catch {
    // Corrupted or unreadable draft payloads are treated as absent; the user just gets a clean box.
    return null
  }
}

export function saveComposerDraftToStorage(sessionId: string, draft: ComposerSessionDraft): void {
  if (!hasStorage() || !sessionId) {
    return
  }
  try {
    if (isComposerDraftEmpty(draft)) {
      window.localStorage.removeItem(storageKey(sessionId))
      return
    }
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(draft))
  } catch {
    // Storage can be unavailable (private mode, quota). Draft persistence is best-effort.
  }
}

export function clearComposerDraftFromStorage(sessionId: string): void {
  if (!hasStorage() || !sessionId) {
    return
  }
  try {
    window.localStorage.removeItem(storageKey(sessionId))
  } catch {
    // Ignore storage failures; the in-memory draft still works for this run.
  }
}

export { DRAFT_PERSISTENCE_DEBOUNCE_MS }
