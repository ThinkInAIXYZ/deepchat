export const DETERMINISTIC_VECTOR_PROFILE = {
  id: 'deterministic-lexicon-v1',
  dimensions: 128,
  normalized: true
} as const

export const RETRIEVAL_SUBSETS = ['exact', 'cjk', 'path', 'code', 'semantic', 'mixed'] as const
export type RetrievalSubset = (typeof RETRIEVAL_SUBSETS)[number]

export interface MemoryRetrievalFixtureV1 {
  version: 1
  vectorProfile: typeof DETERMINISTIC_VECTOR_PROFILE
  corpus: Array<{
    id: string
    agentId: string
    kind: 'episodic' | 'semantic' | 'reflection'
    content: string
    importance: number
  }>
  queries: Array<{
    id: string
    agentId: string
    text: string
    subsets: RetrievalSubset[]
    relevantIds: string[]
  }>
}

export interface RetrievalMetricSummary {
  queryCount: number
  recallAt5: number
  mrrAt10: number
  ndcgAt10: number
  bySubset: Record<RetrievalSubset, RetrievalMetricGroup>
}

export interface RetrievalMetricGroup {
  queryCount: number
  recallAt5: number
  mrrAt10: number
  ndcgAt10: number
}

const CONCEPT_GROUPS = [
  ['outage', 'incident', 'downtime'],
  ['auth', 'login', 'signin'],
  ['latency', 'slowness', 'delay'],
  ['cleanup', 'prune', 'garbage-collect'],
  ['billing', 'invoice', 'payment'],
  ['deploy', 'release', 'rollout'],
  ['cache', 'memoization', 'redis'],
  ['timezone', 'localtime', 'utc'],
  ['concise', 'brief', 'short'],
  ['backup', 'snapshot', 'restore']
] as const

const CONCEPT_BY_TERM = new Map<string, string>()
for (const [index, group] of CONCEPT_GROUPS.entries()) {
  for (const term of group) CONCEPT_BY_TERM.set(term, `concept:${index}`)
}

function hashFeature(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function extractFeatures(text: string, includeConcepts: boolean): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const features = new Set<string>()
  for (const token of normalized.match(/[a-z0-9_./:@#+-]+/g) ?? []) {
    features.add(`token:${token}`)
    for (const part of token.split(/[./:@#+-]+/).filter(Boolean)) features.add(`part:${part}`)
    const concept = CONCEPT_BY_TERM.get(token)
    if (includeConcepts && concept) features.add(concept)
  }
  for (const sequence of normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/gu) ?? []) {
    if (sequence.length < 3) {
      features.add(`cjk:${sequence}`)
      continue
    }
    for (let index = 0; index <= sequence.length - 3; index += 1) {
      features.add(`cjk:${sequence.slice(index, index + 3)}`)
    }
  }
  return [...features].sort()
}

export function deterministicLexiconEmbed(
  text: string,
  options: { includeConcepts?: boolean } = {}
): number[] {
  const vector = Array<number>(DETERMINISTIC_VECTOR_PROFILE.dimensions).fill(0)
  for (const feature of extractFeatures(text, options.includeConcepts !== false)) {
    const hash = hashFeature(feature)
    const index = hash % vector.length
    vector[index] += (hash & 0x80000000) === 0 ? 1 : -1
  }
  const norm = Math.hypot(...vector)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}

export function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index]
  return dot
}

export function validateRetrievalFixture(
  value: unknown
): asserts value is MemoryRetrievalFixtureV1 {
  if (!value || typeof value !== 'object') throw new Error('Fixture must be an object.')
  const fixture = value as Partial<MemoryRetrievalFixtureV1>
  if (fixture.version !== 1) throw new Error('Fixture version must be 1.')
  if (
    fixture.vectorProfile?.id !== DETERMINISTIC_VECTOR_PROFILE.id ||
    fixture.vectorProfile.dimensions !== DETERMINISTIC_VECTOR_PROFILE.dimensions ||
    fixture.vectorProfile.normalized !== true
  ) {
    throw new Error('Fixture vector profile is invalid.')
  }
  if (!Array.isArray(fixture.corpus) || fixture.corpus.length < 200) {
    throw new Error('Fixture must contain at least 200 corpus rows.')
  }
  if (!Array.isArray(fixture.queries) || fixture.queries.length < 60) {
    throw new Error('Fixture must contain at least 60 queries.')
  }
  const corpusIds = new Set<string>()
  for (const row of fixture.corpus) {
    if (!row.id || !row.agentId || !row.content || corpusIds.has(row.id)) {
      throw new Error('Corpus rows require unique IDs, agent IDs, and content.')
    }
    if ('embedding' in row) throw new Error('Fixture rows must not store embeddings.')
    corpusIds.add(row.id)
  }
  for (const query of fixture.queries) {
    if (!query.id || !query.agentId || !query.text || query.relevantIds.length === 0) {
      throw new Error('Queries require IDs, agent IDs, text, and relevant IDs.')
    }
    if (query.relevantIds.some((id) => !corpusIds.has(id))) {
      throw new Error(`Query ${query.id} references an unknown relevant ID.`)
    }
    if ('embedding' in query) throw new Error('Fixture queries must not store embeddings.')
    const relevantAgents = fixture.corpus
      .filter((row) => query.relevantIds.includes(row.id))
      .map((row) => row.agentId)
    if (relevantAgents.some((agentId) => agentId !== query.agentId)) {
      throw new Error(`Query ${query.id} references a relevant row owned by another Agent.`)
    }
    if (query.subsets.some((subset) => !RETRIEVAL_SUBSETS.includes(subset))) {
      throw new Error(`Query ${query.id} has an unknown subset.`)
    }
    if (query.subsets.includes('cjk') && !/[\u3400-\u9fff\uf900-\ufaff]{3,}/u.test(query.text)) {
      throw new Error(`CJK gating query ${query.id} must include at least three CJK characters.`)
    }
  }
  const probe = fixture.queries[0].text
  if (deterministicLexiconEmbed(probe).join(',') !== deterministicLexiconEmbed(probe).join(',')) {
    throw new Error('Deterministic embedder produced unstable output.')
  }
}

function deduplicate(ids: string[]): string[] {
  return [...new Set(ids)]
}

function metricForRankedIds(rankedIds: string[], relevantIds: string[]): RetrievalMetricGroup {
  const ranked = deduplicate(rankedIds)
  const relevant = new Set(relevantIds)
  const recallHits = ranked.slice(0, 5).filter((id) => relevant.has(id)).length
  const firstRelevantIndex = ranked.slice(0, 10).findIndex((id) => relevant.has(id))
  const dcg = ranked
    .slice(0, 10)
    .reduce((sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0), 0)
  const idealCount = Math.min(10, relevant.size)
  let idcg = 0
  for (let index = 0; index < idealCount; index += 1) idcg += 1 / Math.log2(index + 2)
  return {
    queryCount: 1,
    recallAt5: recallHits / relevant.size,
    mrrAt10: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAt10: idcg === 0 ? 0 : dcg / idcg
  }
}

function average(groups: RetrievalMetricGroup[]): RetrievalMetricGroup {
  if (groups.length === 0) return { queryCount: 0, recallAt5: 0, mrrAt10: 0, ndcgAt10: 0 }
  return {
    queryCount: groups.length,
    recallAt5: groups.reduce((sum, item) => sum + item.recallAt5, 0) / groups.length,
    mrrAt10: groups.reduce((sum, item) => sum + item.mrrAt10, 0) / groups.length,
    ndcgAt10: groups.reduce((sum, item) => sum + item.ndcgAt10, 0) / groups.length
  }
}

export function calculateRetrievalMetrics(
  queries: MemoryRetrievalFixtureV1['queries'],
  rankedByQuery: Map<string, string[]>
): RetrievalMetricSummary {
  const all = queries.map((query) =>
    metricForRankedIds(rankedByQuery.get(query.id) ?? [], query.relevantIds)
  )
  const overall = average(all)
  const bySubset = Object.fromEntries(
    RETRIEVAL_SUBSETS.map((subset) => [
      subset,
      average(
        queries.flatMap((query, index) => (query.subsets.includes(subset) ? [all[index]] : []))
      )
    ])
  ) as Record<RetrievalSubset, RetrievalMetricGroup>
  return { ...overall, bySubset }
}
