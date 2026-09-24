import { effectScope, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerTypeToFocus } from '@/features/chat-page/composables/useComposerTypeToFocus'

function createHarness(handle: Record<string, unknown> | null = null) {
  const chatInputRef = ref<any>(handle)
  const focusInput = vi.fn()
  const focusAndInsertText = vi.fn()
  const focusAndPaste = vi.fn()
  chatInputRef.value = handle ?? { focusInput, focusAndInsertText, focusAndPaste }

  const scope: EffectScope = effectScope()
  const isEnabled = ref(true)
  scope.run(() => {
    useComposerTypeToFocus({ isEnabled: () => isEnabled.value, chatInputRef })
  })

  return { scope, chatInputRef, focusInput, focusAndInsertText, focusAndPaste, isEnabled }
}

function dispatchKeydown(
  key: string,
  init: Partial<KeyboardEventInit> & { target?: EventTarget } = {}
): KeyboardEvent {
  const { target, ...rest } = init
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest })
  ;(target ?? window).dispatchEvent(event)
  return event
}

describe('useComposerTypeToFocus', () => {
  let harness: ReturnType<typeof createHarness> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    harness?.scope.stop()
    harness = null
    document.body.innerHTML = ''
  })

  it('focuses the composer and inserts the triggering character', () => {
    harness = createHarness()

    const event = dispatchKeydown('n')

    expect(harness.focusAndInsertText).toHaveBeenCalledWith('n')
    expect(event.defaultPrevented).toBe(true)
  })

  it('inserts a space instead of letting it scroll the transcript', () => {
    harness = createHarness()

    const event = dispatchKeydown(' ')

    expect(harness.focusAndInsertText).toHaveBeenCalledWith(' ')
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves shortcuts, navigation keys, and modified keys untouched', () => {
    harness = createHarness()

    for (const [key, init] of [
      ['c', { metaKey: true }],
      ['v', { ctrlKey: true }],
      ['ArrowDown', {}],
      ['PageUp', {}],
      ['Escape', {}],
      ['Tab', {}],
      ['F5', {}],
      ['Shift', {}]
    ] as const) {
      const event = dispatchKeydown(key, init)
      expect(event.defaultPrevented).toBe(false)
    }

    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('does not steal focus from another text field', () => {
    harness = createHarness()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    dispatchKeydown('a', { target: input })

    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('does not steal focus from an interactive control', () => {
    harness = createHarness()
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    dispatchKeydown('a', { target: button })

    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
  })

  it('keeps typing in the message viewport, which is focusable but not interactive', () => {
    harness = createHarness()
    const viewport = document.createElement('div')
    viewport.tabIndex = 0
    viewport.setAttribute('role', 'region')
    document.body.appendChild(viewport)
    viewport.focus()

    dispatchKeydown('a', { target: viewport })

    expect(harness.focusAndInsertText).toHaveBeenCalledWith('a')
  })

  it('only focuses when the input method owns the keystroke', () => {
    harness = createHarness()

    const event = dispatchKeydown('Process')

    expect(harness.focusInput).toHaveBeenCalledTimes(1)
    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('only focuses on a dead key, leaving the platform free to compose', () => {
    harness = createHarness()

    const event = dispatchKeydown('Dead')

    expect(harness.focusInput).toHaveBeenCalledTimes(1)
    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does nothing while the composer cannot take focus', () => {
    harness = createHarness()
    harness.isEnabled.value = false

    dispatchKeydown('a')

    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(harness.focusInput).not.toHaveBeenCalled()
  })

  it('falls back to focusing when the composer cannot insert text directly', () => {
    harness = createHarness({ focusInput: vi.fn() })

    dispatchKeydown('a')

    expect(harness.chatInputRef.value.focusInput).toHaveBeenCalledTimes(1)
  })

  it('survives a missing composer handle', () => {
    const chatInputRef = ref<any>(null)
    const scope = effectScope()
    scope.run(() => {
      useComposerTypeToFocus({ isEnabled: () => true, chatInputRef })
    })

    expect(() => dispatchKeydown('a')).not.toThrow()

    scope.stop()
  })

  it('detaches when its scope is disposed', () => {
    harness = createHarness()
    harness.scope.stop()

    dispatchKeydown('a')
    window.dispatchEvent(new Event('paste'))

    expect(harness.focusAndInsertText).not.toHaveBeenCalled()
    expect(harness.focusAndPaste).not.toHaveBeenCalled()
  })

  it('routes a paste from the message viewport without requiring a keydown', () => {
    harness = createHarness()
    const viewport = document.createElement('div')
    viewport.tabIndex = 0
    document.body.appendChild(viewport)
    viewport.focus()
    const event = new Event('paste', { bubbles: true, cancelable: true })

    viewport.dispatchEvent(event)

    expect(harness.focusAndPaste).toHaveBeenCalledExactlyOnceWith(event)
  })

  it.each([
    '<input>',
    '<textarea>',
    '<div contenteditable="true" tabindex="0"></div>',
    '<button>Copy</button>',
    '<div role="dialog"><div tabindex="0"></div></div>'
  ])('keeps paste with the focused control: %s', (markup) => {
    harness = createHarness()
    document.body.innerHTML = markup
    const control = (document.querySelector('[tabindex]') ??
      document.body.firstElementChild) as HTMLElement
    control.focus()

    control.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
    // Clipboard events may target the selection outside the focused control.
    document.body.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))

    expect(harness.focusAndPaste).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(control)
  })

  it('routes paste when the selection targets an unfocused button after a blank-area click', () => {
    harness = createHarness()
    document.body.innerHTML = '<main tabindex="-1"><button><span>Model</span></button></main>'
    const viewport = document.querySelector('main')!
    const label = document.querySelector('span')!
    viewport.focus()
    const event = new Event('paste', { bubbles: true, cancelable: true })

    label.dispatchEvent(event)

    expect(harness.focusAndPaste).toHaveBeenCalledExactlyOnceWith(event)
  })

  it('leaves handled pastes and unavailable composers alone', () => {
    harness = createHarness()
    const handled = new Event('paste', { cancelable: true })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(harness.focusAndPaste).not.toHaveBeenCalled()

    harness.isEnabled.value = false
    window.dispatchEvent(new Event('paste'))
    expect(harness.focusAndPaste).not.toHaveBeenCalled()

    harness.isEnabled.value = true
    harness.chatInputRef.value = null
    const event = new Event('paste', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
