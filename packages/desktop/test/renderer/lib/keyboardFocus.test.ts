import { afterEach, describe, expect, it } from 'vitest'
import { hasInteractiveKeyboardFocus, isEditableKeyboardTarget } from '@/lib/keyboardFocus'

function mountMarkup(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('keyboardFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('isEditableKeyboardTarget', () => {
    it('matches native text controls', () => {
      const host = mountMarkup('<input /><textarea></textarea><select></select>')

      for (const element of Array.from(host.children)) {
        expect(isEditableKeyboardTarget(element)).toBe(true)
      }
    })

    it('matches every editable contenteditable form, including the editor surface', () => {
      const host = mountMarkup(
        '<div contenteditable="true"></div><div contenteditable=""></div>' +
          '<div contenteditable="plaintext-only"></div>' +
          '<div role="textbox" data-testid="chat-input-contenteditable"></div>'
      )

      for (const element of Array.from(host.children)) {
        expect(isEditableKeyboardTarget(element)).toBe(true)
      }
    })

    it('matches descendants of an editable surface', () => {
      const host = mountMarkup('<div contenteditable="true"><span id="inner"></span></div>')

      expect(isEditableKeyboardTarget(host.querySelector('#inner'))).toBe(true)
    })

    it('ignores contenteditable="false" node views and plain elements', () => {
      const host = mountMarkup(
        '<div contenteditable="false"></div><div id="plain"></div><div tabindex="0"></div>'
      )

      for (const element of Array.from(host.children)) {
        expect(isEditableKeyboardTarget(element)).toBe(false)
      }
    })

    it('falls back to the active element when the target is not an element', () => {
      const host = mountMarkup('<input id="search" />')
      const input = host.querySelector<HTMLInputElement>('#search')
      input?.focus()

      expect(isEditableKeyboardTarget(null)).toBe(true)
    })
  })

  describe('hasInteractiveKeyboardFocus', () => {
    it('matches controls that own activation keys', () => {
      const host = mountMarkup(
        '<button></button><a href="#x"></a><div role="tab"></div>' +
          '<div role="combobox"></div><div role="slider"></div>'
      )

      for (const element of Array.from(host.children)) {
        expect(hasInteractiveKeyboardFocus(element)).toBe(true)
      }
    })

    it('matches descendants of modal dialogs and popovers', () => {
      const host = mountMarkup(
        '<div role="dialog"><div id="dialog-body"></div></div>' +
          '<div data-slot="dialog-content"><div id="slot-body"></div></div>' +
          '<div data-reka-popper-content-wrapper><div id="popper-body"></div></div>'
      )

      expect(hasInteractiveKeyboardFocus(host.querySelector('#dialog-body'))).toBe(true)
      expect(hasInteractiveKeyboardFocus(host.querySelector('#slot-body'))).toBe(true)
      expect(hasInteractiveKeyboardFocus(host.querySelector('#popper-body'))).toBe(true)
    })

    it('does not treat the focusable message scroll container as interactive', () => {
      const host = mountMarkup(
        '<div tabindex="0" role="region" aria-label="session" id="viewport"></div>' +
          '<div tabindex="-1" id="skip-link"></div>'
      )

      expect(hasInteractiveKeyboardFocus(host.querySelector('#viewport'))).toBe(false)
      expect(hasInteractiveKeyboardFocus(host.querySelector('#skip-link'))).toBe(false)
    })

    it('ignores plain content and links without an href', () => {
      const host = mountMarkup('<p id="text">hello</p><a id="anchor">no href</a>')

      expect(hasInteractiveKeyboardFocus(host.querySelector('#text'))).toBe(false)
      expect(hasInteractiveKeyboardFocus(host.querySelector('#anchor'))).toBe(false)
    })

    it('falls back to the active element when the target is not an element', () => {
      const host = mountMarkup('<button id="action"></button>')
      const button = host.querySelector<HTMLButtonElement>('#action')
      button?.focus()

      expect(hasInteractiveKeyboardFocus(null)).toBe(true)
    })
  })
})
