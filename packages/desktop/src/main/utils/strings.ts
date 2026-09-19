/**
 * Sanitizes text content for processing in knowledge base systems.
 * Performs the following transformations:
 * - Removes backslashes
 * - Replaces hash characters with spaces
 * - Converts spaced double periods to single periods
 * - Normalizes line breaks to \n
 * - Collapses multiple consecutive spaces (but preserves single line breaks)
 * - Trims leading and trailing whitespace
 *
 * @param text - The input text to sanitize
 * @returns The sanitized text
 * @throws Error if input is not a string
 */
export function sanitizeText(text: string) {
  if (typeof text !== 'string') {
    throw new Error('Input must be a string')
  }
  if (text.length === 0) {
    return text
  }
  return text
    .replace(/\\/g, '')
    .replace(/#/g, ' ')
    .replace(/\. \./g, '.')
    .replace(/(\r\n|\r)/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
