import { getSessionReferenceText, type SessionReference } from '@shared/sessionReferences'

export function createSessionReferenceElement(reference: SessionReference): HTMLSpanElement {
  const element = document.createElement('span')
  element.setAttribute('data-session-reference', '')
  for (const [name, value] of Object.entries(reference)) {
    if (value !== null) element.setAttribute(`data-${name}`, value)
  }
  element.textContent = getSessionReferenceText([{ ...reference, type: 'session' }])
  return element
}

export async function copySessionReference(reference: SessionReference): Promise<void> {
  const element = createSessionReferenceElement(reference)
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([element.textContent ?? ''], { type: 'text/plain' }),
      'text/html': new Blob([element.outerHTML], { type: 'text/html' })
    })
  ])
}
