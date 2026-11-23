const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const CODE_KEYS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'space'
}

function eventKey(event: KeyboardEvent): string {
  if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase()
  if (event.code.startsWith('Digit')) return event.code.slice(5)
  return CODE_KEYS[event.code] ?? event.key.toLowerCase()
}

/**
 * Matches a keyboard event against an Electron accelerator such as `Control+\``. Physical key codes
 * are used so Shift or keyboard layouts do not change the produced character.
 */
export function matchesAccelerator(event: KeyboardEvent, accelerator: string | undefined): boolean {
  if (!accelerator) return false
  const parts = accelerator.split('+').filter(Boolean)
  // A trailing "+" means the key itself is plus.
  if (accelerator.endsWith('++')) parts.push('+')
  const key = parts.pop()?.toLowerCase()
  if (!key) return false
  const wanted = { meta: false, ctrl: false, alt: false, shift: false }
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'commandorcontrol':
      case 'cmdorctrl':
        if (isMac()) wanted.meta = true
        else wanted.ctrl = true
        break
      case 'command':
      case 'cmd':
      case 'meta':
      case 'super':
        wanted.meta = true
        break
      case 'control':
      case 'ctrl':
        wanted.ctrl = true
        break
      case 'alt':
      case 'option':
        wanted.alt = true
        break
      case 'shift':
        wanted.shift = true
        break
      default:
        return false
    }
  }
  return (
    event.metaKey === wanted.meta &&
    event.ctrlKey === wanted.ctrl &&
    event.altKey === wanted.alt &&
    event.shiftKey === wanted.shift &&
    eventKey(event) === key
  )
}
