export function sanitizeText(s: string | null | undefined, maxLen?: number) {
  if (!s) return ''
  let out = String(s)
  // Remove ASCII control chars except common whitespace (keep \n, \t, \r)
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // Remove explicit zero-width / soft-hyphen characters
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g, '')

  // Normalize and strip combining marks; use Unicode property escapes when available
  try {
    out = out.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
  } catch {
    out = out.normalize
      ? out
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .normalize('NFC')
      : out
  }

  // Only truncate when an explicit maxLen is provided
  if (typeof maxLen === 'number' && isFinite(maxLen) && maxLen >= 0 && out.length > maxLen) {
    out = out.slice(0, maxLen)
  }
  return out
}
