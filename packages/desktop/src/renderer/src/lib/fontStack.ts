export const DEFAULT_TEXT_FONT_STACK =
  "'Geist', Noto Sans, ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'"

export const DEFAULT_CODE_FONT_STACK =
  "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace"

export const buildFontStack = (custom: string, fallback: string) => {
  const normalized = (custom || '').trim()
  if (!normalized) return fallback
  const wrapped =
    /\s/.test(normalized) && !normalized.includes(',') ? `"${normalized}"` : normalized
  return `${wrapped}, ${fallback}`
}
