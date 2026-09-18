/**
 * Focus predicates for renderer-level keyboard routing.
 *
 * They exist so that features which intercept global keydown (type-to-focus,
 * list scroll intent, session shortcuts) agree on what "the user is already
 * typing somewhere" and "some control owns the keyboard" mean.
 */

/** Anything that natively consumes typed characters. */
const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  // `contenteditable=""` and `plaintext-only` are editable too, so match every
  // value except the explicit opt-out. ProseMirror's attribute literal is not
  // part of our contract.
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]'
].join(', ')

/**
 * Controls that own keyboard interaction while focused: activation keys,
 * roving tab stops, and modal focus traps. A bare `[tabindex]` is deliberately
 * absent — the message scroll container is `tabindex="0"` and must stay a
 * valid type-to-focus surface.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="toolbar"]',
  // reka-ui writes role but no aria-modal, so the modal test cannot require it.
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
  '[data-reka-popper-content-wrapper]',
  '[data-radix-popper-content-wrapper]'
].join(', ')

function resolveElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target
  }

  return document.activeElement
}

/** True when the target (or its ancestors) natively consumes typed characters. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return Boolean(resolveElement(target)?.closest(EDITABLE_SELECTOR))
}

/** True when the target (or its ancestors) is a control that owns the keyboard. */
export function hasInteractiveKeyboardFocus(target: EventTarget | null): boolean {
  return Boolean(resolveElement(target)?.closest(INTERACTIVE_SELECTOR))
}
