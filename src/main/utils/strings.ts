/**
 * Sanitizes text content for processing in knowledge base systems.
 * Performs the following transformations:
 * - Removes backslashes
 * - Replaces hash characters with spaces
 * - Converts spaced double periods to single periods
 * - Collapses multiple whitespace characters into single spaces
 * - Replaces all newline variants with spaces
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
  text = text.replace(/\\/g, '')
  text = text.replace(/#/g, ' ')
  text = text.replace(/\. \./g, '.')
  text = text.replace(/\s\s+/g, ' ')
  text = text.replace(/(\r\n|\n|\r)/gm, ' ')
  return text.trim()
}
