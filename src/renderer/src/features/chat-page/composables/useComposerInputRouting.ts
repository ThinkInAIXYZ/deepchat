import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { hasInteractiveKeyboardFocus, isEditableKeyboardTarget } from '@/lib/keyboardFocus'
import {
  resolveComposerKeydownIntent,
  shouldRouteComposerPaste
} from '../model/composerInputRouting'

export type ComposerInputHandle = {
  focusInput?: () => void
  focusAndInsertText?: (text: string) => void
  focusAndPaste?: (event: ClipboardEvent) => void
}

type UseComposerInputRoutingOptions = {
  /** False for read-only sessions, inert composers, and blocking interactions. */
  isEnabled: () => boolean
  chatInputRef: Ref<ComposerInputHandle | null>
}

/**
 * Routes typing and paste from the page into the composer.
 *
 * Owns its own window listener instead of joining `useChatPageEventBridge`
 * because the new-thread page has no event bridge but needs the same behavior.
 * Both pages share this composable; the listener detaches with the component
 * scope.
 */
export function useComposerInputRouting(options: UseComposerInputRoutingOptions): void {
  useEventListener(
    window,
    'paste',
    (event: ClipboardEvent) => {
      // Chromium can target a retained selection even when its editor no longer has focus.
      const activeElement = document.activeElement
      if (
        !shouldRouteComposerPaste(event, {
          isEnabled: options.isEnabled(),
          isEditableTarget: isEditableKeyboardTarget(activeElement),
          hasInteractiveFocus: hasInteractiveKeyboardFocus(activeElement)
        })
      ) {
        return
      }

      options.chatInputRef.value?.focusAndPaste?.(event)
      if (event.defaultPrevented) {
        // The composer handled this paste; its target must not insert it again.
        event.stopPropagation()
      }
    },
    { capture: true }
  )

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const intent = resolveComposerKeydownIntent(event, {
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
