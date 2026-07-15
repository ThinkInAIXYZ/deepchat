import type { DatabaseRepairSuggestedPayload } from '@shared/presenter'

interface SchemaErrorMatch {
  reason: string
  dedupeKey: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }

  return String(error ?? '')
}

export function classifySchemaError(error: unknown): SchemaErrorMatch | null {
  const message = getErrorMessage(error)

  const tableAndColumnPatterns: Array<[RegExp, (match: RegExpMatchArray) => SchemaErrorMatch]> = [
    [
      /no such table:\s*("?[\w-]+"?)/i,
      (match) => ({
        reason: 'missing-table',
        dedupeKey: `missing-table:${match[1].replace(/"/g, '')}`
      })
    ],
    [
      /has no column named\s*("?[\w-]+"?)/i,
      (match) => ({
        reason: 'missing-column',
        dedupeKey: `missing-column:${match[1].replace(/"/g, '')}`
      })
    ],
    [
      /no such column:\s*("?[\w-]+"?)/i,
      (match) => ({
        reason: 'missing-column',
        dedupeKey: `missing-column:${match[1].replace(/"/g, '')}`
      })
    ],
    [
      /table\s+("?[\w-]+"?)\s+has\s+\d+\s+columns?\s+but\s+\d+\s+values?\s+were\s+supplied/i,
      (match) => ({
        reason: 'column-count-mismatch',
        dedupeKey: `column-count-mismatch:${match[1].replace(/"/g, '')}`
      })
    ]
  ]

  for (const [pattern, mapMatch] of tableAndColumnPatterns) {
    const match = message.match(pattern)
    if (match) {
      return mapMatch(match)
    }
  }

  return null
}

export function buildDatabaseRepairSuggestedPayload(
  error: unknown
): DatabaseRepairSuggestedPayload | null {
  const classified = classifySchemaError(error)
  if (!classified) {
    return null
  }

  return {
    title: 'settings.data.databaseRepair.toastSuggestedTitle',
    message: 'settings.data.databaseRepair.toastSuggestedDescription',
    reason: classified.reason,
    dedupeKey: classified.dedupeKey
  }
}
