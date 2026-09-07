export const PDF_OCR_TRUNCATION_MARKER = '[… PDF OCR truncated …]'

export interface DocumentOcrTextPageSpan {
  readonly pageNumber: number
  readonly start: number
  readonly end: number
  readonly complete: boolean
}

export function isValidDocumentOcrTextPageSpans(
  text: string,
  spans: unknown,
  options: {
    readonly maxSpans: number
    readonly startPage?: number
  }
): spans is DocumentOcrTextPageSpan[] {
  if (
    !Array.isArray(spans) ||
    !Number.isSafeInteger(options.maxSpans) ||
    options.maxSpans < 0 ||
    spans.length > options.maxSpans
  ) {
    return false
  }

  const startPage = options.startPage ?? 1
  if (!Number.isSafeInteger(startPage) || startPage <= 0) return false

  let expectedStart = 0
  for (let index = 0; index < spans.length; index += 1) {
    const value = spans[index]
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const span = value as Record<string, unknown>
    if (
      span.pageNumber !== startPage + index ||
      !isIntegerInRange(span.start, 0, text.length) ||
      span.start !== expectedStart ||
      !isIntegerInRange(span.end, span.start as number, text.length) ||
      typeof span.complete !== 'boolean' ||
      (!span.complete && index !== spans.length - 1) ||
      (!span.complete && span.end === span.start)
    ) {
      return false
    }

    const chunk = text.slice(span.start as number, span.end as number)
    if (chunk) {
      const prefix = `${(span.start as number) > 0 ? '\n\n' : ''}## Page ${span.pageNumber}\n\n`
      if (!chunk.startsWith(prefix)) return false
      const body = chunk.slice(prefix.length)
      if (span.complete && body.length === 0) return false
      if (!span.complete && body !== PDF_OCR_TRUNCATION_MARKER) {
        const markerSuffix = `\n\n${PDF_OCR_TRUNCATION_MARKER}`
        if (!body.endsWith(markerSuffix)) return false
        const retainedBody = body.slice(0, -markerSuffix.length)
        if (!retainedBody || retainedBody.trimEnd() !== retainedBody) return false
      }
    } else if (!span.complete) {
      return false
    }
    expectedStart = span.end as number
  }

  return expectedStart === text.length
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}
