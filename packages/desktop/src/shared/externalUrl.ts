export const ALLOWED_EXTERNAL_PROTOCOLS = Object.freeze([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'deepchat:'
] as const)

const ALLOWED_EXTERNAL_PROTOCOL_SET = new Set<string>(ALLOWED_EXTERNAL_PROTOCOLS)

export function normalizeExternalUrl(url: string): string | null {
  const trimmedUrl = url.trim()
  if (!trimmedUrl) {
    return null
  }

  try {
    const parsed = new URL(trimmedUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOL_SET.has(parsed.protocol.toLowerCase())) {
      return null
    }
    return trimmedUrl
  } catch {
    return null
  }
}

export function isValidExternalUrl(url: string): boolean {
  return normalizeExternalUrl(url) !== null
}
