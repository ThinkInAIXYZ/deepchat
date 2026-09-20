import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { hasInteractiveKeyboardFocus, isEditableKeyboardTarget } from '@/lib/keyboardFocus'
import { resolveComposerTypeToFocusIntent } from '../model/typeToFocus'

export type ComposerTypeToFocusHandle = {
  focusInput?: () => void
  focusAndInsertText?: (text: string) => void
}

type UseComposerTypeToFocusOptions = {
  /** False for read-only sessions, inert composers, and blocking interactions. */
  isEnabled: () => boolean
  chatInputRef: Ref<ComposerTypeToFocusHandle | null>
}

/**
 * Routes the first keystroke of a window-level typing session into the composer.
 *
 * Owns its own window listener instead of joining `useChatPageEventBridge`
 * because the new-thread page has no event bridge but needs the same behavior.
 * Both pages share this composable; the listener detaches with the component
 * scope.
 */
export function useComposerTypeToFocus(options: UseComposerTypeToFocusOptions): void {
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
