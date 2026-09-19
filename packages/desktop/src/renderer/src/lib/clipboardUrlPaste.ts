type ClipboardTextReader = Pick<DataTransfer, 'getData'>

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i

function readClipboardText(data: ClipboardTextReader, format: string) {
  try {
    return data.getData(format) || ''
  } catch {
    return ''
  }
}

function stripAngleBrackets(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function normalizeSingleHttpUrl(value: string): string | null {
  const candidate = stripAngleBrackets(value.split('\u0000').join(''))

  if (
    !candidate ||
    /\s/.test(candidate) ||
    /[<>]/.test(candidate) ||
    !HTTP_URL_PATTERN.test(candidate)
  ) {
    return null
  }

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return candidate
  } catch {
    return null
  }
}

function extractSingleUriListUrl(value: string) {
  const entries = value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  if (entries.length !== 1) {
    return null
  }

  return normalizeSingleHttpUrl(entries[0])
}

export function extractPlainUrlFromClipboard(
  data: ClipboardTextReader | null | undefined
): string | null {
  if (!data) {
    return null
  }

  const plainText = readClipboardText(data, 'text/plain')
  if (plainText.trim()) {
    return normalizeSingleHttpUrl(plainText)
  }

  return extractSingleUriListUrl(readClipboardText(data, 'text/uri-list'))
}
