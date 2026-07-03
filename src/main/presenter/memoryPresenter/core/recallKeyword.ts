import type { RecallKeywordTermStat } from '../types'

export type RecallKeywordCandidateKind = 'ascii' | 'code' | 'cjk'

export interface RecallKeywordCandidate {
  term: string
  position: number
  kind: RecallKeywordCandidateKind
}

const RECALL_KEYWORD_MAX_CANDIDATES = 24
const RECALL_KEYWORD_MAX_TERMS = 8
const RECALL_KEYWORD_MIN_ASCII_TERM_LENGTH = 3
const RECALL_KEYWORD_MIN_CODE_TERM_LENGTH = 2
const RECALL_KEYWORD_CJK_WINDOW = 4
const RECALL_KEYWORD_HIGH_FREQUENCY_MIN_ROWS = 4
const RECALL_KEYWORD_HIGH_FREQUENCY_RATIO = 0.5

const CODE_EDGE_RE = /^[._:/@#+-]+|[._:/@#+-]+$/g
const CJK_SEQUENCE_RE = /^[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+$/u
const RECALL_KEYWORD_TOKEN_RE =
  /[A-Za-z0-9_][A-Za-z0-9_.:/@#+-]*|[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/gu

function pushCandidate(
  candidates: RecallKeywordCandidate[],
  seen: Set<string>,
  term: string,
  position: number,
  kind: RecallKeywordCandidateKind
): void {
  const normalized = term.trim().toLowerCase().replace(CODE_EDGE_RE, '')
  if (!normalized || seen.has(normalized)) return
  seen.add(normalized)
  candidates.push({ term: normalized, position, kind })
}

function classifyAsciiTerm(term: string): RecallKeywordCandidateKind {
  return /[._:/@#+-]|\d/u.test(term) ? 'code' : 'ascii'
}

export function extractRecallKeywordCandidates(query: string): RecallKeywordCandidate[] {
  const candidates: RecallKeywordCandidate[] = []
  const seen = new Set<string>()

  for (const match of query.matchAll(RECALL_KEYWORD_TOKEN_RE)) {
    if (candidates.length >= RECALL_KEYWORD_MAX_CANDIDATES) break
    const sequence = match[0]
    const start = match.index ?? 0
    if (CJK_SEQUENCE_RE.test(sequence)) {
      if (sequence.length <= RECALL_KEYWORD_CJK_WINDOW) {
        pushCandidate(candidates, seen, sequence, start, 'cjk')
      } else {
        for (let index = 0; index <= sequence.length - RECALL_KEYWORD_CJK_WINDOW; index += 1) {
          if (candidates.length >= RECALL_KEYWORD_MAX_CANDIDATES) break
          pushCandidate(
            candidates,
            seen,
            sequence.slice(index, index + RECALL_KEYWORD_CJK_WINDOW),
            start + index,
            'cjk'
          )
        }
      }
    } else {
      const rawTerm = sequence.replace(CODE_EDGE_RE, '')
      const kind = classifyAsciiTerm(rawTerm)
      const minLength =
        kind === 'code' ? RECALL_KEYWORD_MIN_CODE_TERM_LENGTH : RECALL_KEYWORD_MIN_ASCII_TERM_LENGTH
      if (rawTerm.length >= minLength) {
        pushCandidate(candidates, seen, rawTerm, start, kind)
      }
    }
  }

  return candidates
}

export function selectRecallKeywordTerms(
  candidates: RecallKeywordCandidate[],
  stats: RecallKeywordTermStat[]
): string[] {
  const byTerm = new Map(stats.map((stat) => [stat.term.toLowerCase(), stat]))
  const scored = candidates
    .map((candidate) => ({ candidate, stat: byTerm.get(candidate.term) }))
    .filter(
      (entry): entry is { candidate: RecallKeywordCandidate; stat: RecallKeywordTermStat } =>
        (entry.stat?.hitCount ?? 0) > 0
    )

  if (!scored.length) return []

  const lowFrequency = scored.filter(
    ({ stat }) =>
      stat.totalRows < RECALL_KEYWORD_HIGH_FREQUENCY_MIN_ROWS ||
      stat.hitCount <= stat.totalRows * RECALL_KEYWORD_HIGH_FREQUENCY_RATIO
  )
  const pool = lowFrequency.length ? lowFrequency : scored
  const selected = [...pool]
    .sort(
      (left, right) =>
        left.stat.hitCount - right.stat.hitCount ||
        right.candidate.term.length - left.candidate.term.length ||
        left.candidate.position - right.candidate.position
    )
    .slice(0, lowFrequency.length ? RECALL_KEYWORD_MAX_TERMS : 1)

  return selected
    .sort((left, right) => left.candidate.position - right.candidate.position)
    .map(({ candidate }) => candidate.term)
}

export function buildRecallKeywordQuery(terms: string[]): string {
  return terms.join(' ')
}
