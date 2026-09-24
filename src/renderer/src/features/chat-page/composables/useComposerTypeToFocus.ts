import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { hasInteractiveKeyboardFocus, isEditableKeyboardTarget } from '@/lib/keyboardFocus'
import { resolveComposerTypeToFocusIntent } from '../model/typeToFocus'

export type ComposerTypeToFocusHandle = {
  focusInput?: () => void
  focusAndInsertText?: (text: string) => void
  focusAndPaste?: (event: ClipboardEvent) => void
}

type UseComposerTypeToFocusOptions = {
  /** False for read-only sessions, inert composers, and blocking interactions. */
  isEnabled: () => boolean
  chatInputRef: Ref<ComposerTypeToFocusHandle | null>
}

/**
 * Routes typing and paste from the page into the composer.
 *
 * Owns its own window listener instead of joining `useChatPageEventBridge`
 * because the new-thread page has no event bridge but needs the same behavior.
 * Both pages share this composable; the listener detaches with the component
 * scope.
 */
export function useComposerTypeToFocus(options: UseComposerTypeToFocusOptions): void {
  useEventListener(window, 'paste', (event: ClipboardEvent) => {
    // Chromium can target the DOM selection inside an unfocused button after a blank-area click.
    const activeElement = document.activeElement
    if (
      event.defaultPrevented ||
      !options.isEnabled() ||
      isEditableKeyboardTarget(activeElement) ||
      hasInteractiveKeyboardFocus(activeElement)
    ) {
      return
    }

    options.chatInputRef.value?.focusAndPaste?.(event)
  })

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const intent = resolveComposerTypeToFocusIntent(event, {
      isEnabled: options.isEnabled(),
      isEditableTarget: isEditableKeyboardTarget(event.target),
      hasInteractiveFocus: hasInteractiveKeyboardFocus(event.target)
    })

    if (intent.kind === 'ignore') {
      return
    }

    const chatInput = options.chatInputRef.value
    if (!chatInput?.focusInput) {
      return
    }

    if (intent.kind === 'focus-only') {
      // Input method composition: focusing is enough, the IME owns the text.
      chatInput.focusInput()
      return
    }

    // Suppress the native default (notably Space scrolling the transcript)
    // before the character is inserted programmatically.
    event.preventDefault()
    if (chatInput.focusAndInsertText) {
      chatInput.focusAndInsertText(intent.text)
      return
    }

    chatInput.focusInput()
  })
}
