import { describe, expect, it } from 'vitest'
import {
  resolveComposerKeydownIntent,
  shouldRouteComposerPaste,
  type ComposerInputRoutingContext
} from '@/features/chat-page/model/composerInputRouting'

const ENABLED_CONTEXT: ComposerInputRoutingContext = {
  isEnabled: true,
  isEditableTarget: false,
  hasInteractiveFocus: false
}

describe('shouldRouteComposerPaste', () => {
  it('routes an unhandled paste when the composer is available and no control owns focus', () => {
    expect(shouldRouteComposerPaste({ defaultPrevented: false }, ENABLED_CONTEXT)).toBe(true)
  })

  it('leaves already handled pastes alone', () => {
    expect(shouldRouteComposerPaste({ defaultPrevented: true }, ENABLED_CONTEXT)).toBe(false)
  })

  it.each([{ isEnabled: false }, { isEditableTarget: true }, { hasInteractiveFocus: true }])(
    'does not route paste when blocked by %j',
    (context) => {
      expect(
        shouldRouteComposerPaste({ defaultPrevented: false }, { ...ENABLED_CONTEXT, ...context })
      ).toBe(false)
    }
  )
})

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    ...init
  } as KeyboardEvent
}

function resolve(
  init: Partial<KeyboardEvent> & { key: string },
  context: Partial<ComposerInputRoutingContext> = {}
) {
  return resolveComposerKeydownIntent(keyEvent(init), { ...ENABLED_CONTEXT, ...context })
}

describe('resolveComposerKeydownIntent', () => {
  it('focuses and inserts a printable character', () => {
    expect(resolve({ key: 'n' })).toEqual({ kind: 'focus-and-insert', text: 'n' })
    expect(resolve({ key: '你' })).toEqual({ kind: 'focus-and-insert', text: '你' })
  })

  it('treats Space as input rather than a scroll key', () => {
    expect(resolve({ key: ' ' })).toEqual({ kind: 'focus-and-insert', text: ' ' })
  })

  it('keeps Shift-modified characters, including uppercase', () => {
    expect(resolve({ key: 'A', shiftKey: true })).toEqual({ kind: 'focus-and-insert', text: 'A' })
  })

  it('ignores events another handler already claimed', () => {
    expect(resolve({ key: 'a', defaultPrevented: true })).toEqual({ kind: 'ignore' })
  })

  it('leaves shortcut chords to the platform', () => {
    expect(resolve({ key: 'c', metaKey: true })).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'v', ctrlKey: true })).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'f', altKey: true })).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'Shift' })).toEqual({ kind: 'ignore' })
  })

  it('ignores navigation and function keys', () => {
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      'Escape',
      'Tab',
      'Enter',
      'Backspace',
      'Delete',
      'F5',
      'Unidentified'
    ]) {
      expect(resolve({ key })).toEqual({ kind: 'ignore' })
    }
  })

  it('ignores control characters that report a single code unit', () => {
    expect(resolve({ key: '\u007f' })).toEqual({ kind: 'ignore' })
    expect(resolve({ key: '\u0000' })).toEqual({ kind: 'ignore' })
  })

  it('never steals focus from another editable target, even mid-composition', () => {
    const context = { isEditableTarget: true }

    expect(resolve({ key: 'a' }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'n', keyCode: 229 }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'n', isComposing: true }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'Process' }, context)).toEqual({ kind: 'ignore' })
  })

  it('never steals focus from an interactive control', () => {
    const context = { hasInteractiveFocus: true }

    expect(resolve({ key: 'a' }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'n', keyCode: 229 }, context)).toEqual({ kind: 'ignore' })
  })

  it('ignores everything while the composer cannot take focus', () => {
    const context = { isEnabled: false }

    expect(resolve({ key: 'a' }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: ' ' }, context)).toEqual({ kind: 'ignore' })
    expect(resolve({ key: 'n', keyCode: 229 }, context)).toEqual({ kind: 'ignore' })
  })

  it('focuses without inserting while the input method owns the keystroke', () => {
    expect(resolve({ key: 'Process' })).toEqual({ kind: 'focus-only' })
    expect(resolve({ key: 'n', keyCode: 229 })).toEqual({ kind: 'focus-only' })
    expect(resolve({ key: 'n', isComposing: true })).toEqual({ kind: 'focus-only' })
  })

  it('focuses without inserting on a dead key so the next keystroke composes', () => {
    // Dead key + 'e' should produce 'é': the dead key only moves focus, and the
    // following letter is then handled natively by the focused editor.
    expect(resolve({ key: 'Dead' })).toEqual({ kind: 'focus-only' })
  })

  it('does not treat a dead key as a printable character', () => {
    expect(resolve({ key: 'Dead' })).not.toEqual({ kind: 'focus-and-insert', text: 'Dead' })
  })

  it('does not treat keyCode 229 as a printable character', () => {
    // 'Process' is seven code units long, so the IME branch must win over the
    // single-character test.
    expect(resolve({ key: 'Process', keyCode: 229 })).not.toEqual({
      kind: 'focus-and-insert',
      text: 'Process'
    })
  })
})
