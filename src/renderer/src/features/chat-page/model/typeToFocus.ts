/**
 * Decides what a window-level keydown should do for the chat composer.
 *
 * Kept as a pure function so the routing rules — which are the whole contract of
 * type-to-focus — can be tested without mounting a page or an editor.
 */

export type ComposerTypeToFocusIntent =
  /** Leave the event alone: another handler or control owns it. */
  | { kind: 'ignore' }
  /** Start the input method in the composer without inserting anything. */
  | { kind: 'focus-only' }
  /** Focus the composer and insert the character that triggered the focus. */
  | { kind: 'focus-and-insert'; text: string }

export type ComposerTypeToFocusContext = {
  /** False for read-only sessions, inert composers, and blocking interactions. */
  isEnabled: boolean
  isEditableTarget: boolean
  hasInteractiveFocus: boolean
}

/** C0 controls plus DEL: the non-printable single-code-unit keys. */
function isControlCharacter(key: string): boolean {
  const code = key.charCodeAt(0)
  return code <= 0x1f || code === 0x7f
}

export function resolveComposerTypeToFocusIntent(
  event: KeyboardEvent,
  context: ComposerTypeToFocusContext
): ComposerTypeToFocusIntent {
  if (event.defaultPrevented) {
    return { kind: 'ignore' }
  }

  // Shortcuts and AltGr-style chords keep their native behavior. A bare Shift
  // still reports a printable `key` (e.g. 'A'), so it is intentionally allowed.
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return { kind: 'ignore' }
  }

  // Ownership comes before intent: a composition already running in another
  // field (the chat search box, a dialog input) must keep its keystrokes.
  if (context.isEditableTarget || context.hasInteractiveFocus) {
    return { kind: 'ignore' }
  }

  if (!context.isEnabled) {
    return { kind: 'ignore' }
  }

  // Input method keystrokes arrive as a composition, keyCode 229, or 'Process'.
  // Preventing them would break the input method, and inserting the reported key
  // would duplicate what the composition is about to commit.
  if (event.isComposing || event.keyCode === 229 || event.key === 'Process') {
    return { kind: 'focus-only' }
  }

  // Navigation and function keys, plus 'Dead'/'Unidentified'. Space is a single
  // printable character and is deliberately included here.
  if (event.key.length !== 1 || isControlCharacter(event.key)) {
    return { kind: 'ignore' }
  }

  return { kind: 'focus-and-insert', text: event.key }
}
