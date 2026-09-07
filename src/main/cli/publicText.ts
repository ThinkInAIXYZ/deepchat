const PUBLIC_TEXT_SCAN_FACTOR = 16
const PUBLIC_LIST_SCAN_FACTOR = 16

export type SanitizedPublicText = Readonly<{ value: string; truncated: boolean }>
export type SanitizedPublicList = Readonly<{ values: string[]; truncated: boolean }>

export function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPublicTextControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
}

function isDirectionalControl(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

export function stripC0AndC1Controls(value: string, maxCodeUnits: number): string {
  if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 0) {
    throw new RangeError('Public text scan limit must be a non-negative safe integer')
  }
  if (value.length > maxCodeUnits) {
    throw new RangeError('Public text exceeds its scan limit')
  }

  const output: string[] = []
  for (const character of value) {
    if (!isPublicTextControl(character.codePointAt(0)!)) output.push(character)
  }
  return output.join('')
}

export function sanitizePublicText(value: unknown, maxBytes: number): SanitizedPublicText {
  if (typeof value !== 'string') return { value: '', truncated: false }
  const output: string[] = []
  let bytes = 0
  let consumedCodeUnits = 0
  let pendingSpace = false
  let truncated = false
  const maxScannedCodeUnits = maxBytes * PUBLIC_TEXT_SCAN_FACTOR

  for (const character of value) {
    consumedCodeUnits += character.length
    if (consumedCodeUnits > maxScannedCodeUnits) {
      truncated = true
      break
    }
    const codePoint = character.codePointAt(0)!
    if (isDirectionalControl(codePoint)) continue
    if (isPublicTextControl(codePoint) || character.trim() === '') {
      pendingSpace = output.length > 0
      continue
    }

    if (pendingSpace) {
      if (bytes + 1 > maxBytes) {
        truncated = true
        break
      }
      output.push(' ')
      bytes += 1
      pendingSpace = false
    }
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maxBytes) {
      truncated = true
      break
    }
    output.push(character)
    bytes += characterBytes
  }
  return {
    value: output.join(''),
    truncated: truncated || consumedCodeUnits < value.length
  }
}

export function sanitizePublicStringList(
  value: unknown,
  maxItems: number,
  maxBytes: number
): SanitizedPublicList {
  if (!Array.isArray(value)) return { values: [], truncated: false }
  let itemTruncated = false
  const maxScannedItems = maxItems * PUBLIC_LIST_SCAN_FACTOR
  const scannedValues = value.slice(0, maxScannedItems)
  const values = Array.from(
    new Set(
      scannedValues
        .map((entry) => {
          const sanitized = sanitizePublicText(entry, maxBytes)
          itemTruncated ||= sanitized.truncated
          return sanitized.value
        })
        .filter((entry) => entry.length > 0)
    )
  ).sort(compareStableText)
  return {
    values: values.slice(0, maxItems),
    truncated: itemTruncated || value.length > scannedValues.length || values.length > maxItems
  }
}
