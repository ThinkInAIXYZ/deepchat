import { unicodeCodePointLength } from '@shared/lib/unicodeText'

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
const RECALL_KEYWORD_KIND_PRIORITY: Record<RecallKeywordCandidateKind, number> = {
  code: 0,
  cjk: 1,
  ascii: 2
}

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

export function selectRecallKeywordTerms(candidates: RecallKeywordCandidate[]): string[] {
  const trigramSafe = candidates.filter((candidate) => unicodeCodePointLength(candidate.term) >= 3)
  const selectable = trigramSafe.length > 0 ? trigramSafe : candidates
  return [...selectable]
    .sort(
      (left, right) =>
        RECALL_KEYWORD_KIND_PRIORITY[left.kind] - RECALL_KEYWORD_KIND_PRIORITY[right.kind] ||
        unicodeCodePointLength(right.term) - unicodeCodePointLength(left.term) ||
        left.position - right.position
    )
    .slice(0, RECALL_KEYWORD_MAX_TERMS)
    .sort((left, right) => left.position - right.position)
    .map((candidate) => candidate.term)
}

export function buildRecallKeywordQuery(terms: string[]): string {
  return terms.join(' ')
}
