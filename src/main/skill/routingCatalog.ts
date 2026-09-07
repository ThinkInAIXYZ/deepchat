import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { approximateTokenSize } from 'tokenx'
import type {
  SkillListInput,
  SkillListItem,
  SkillListResult,
  SkillMetadata
} from '@shared/types/skill'
import { SKILL_NAME_MAX_LENGTH } from '@shared/types/skill'

export const SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS = 1_024
export const SKILL_ROUTING_DESCRIPTION_MAX_BYTES = SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS * 4
export const SKILL_ROUTING_CATEGORY_MAX_CODE_POINTS = 128
export const SKILL_ROUTING_PLATFORM_MAX_CODE_POINTS = 64
export const SKILL_ROUTING_PLATFORM_MAX_COUNT = 8
export const SKILL_ROUTING_CATALOG_MAX_TOKENS = 2_000
export const SKILL_ROUTING_CATALOG_CONTEXT_RATIO = 0.02
export const SKILL_LIST_DEFAULT_LIMIT = 10
export const SKILL_LIST_MAX_LIMIT = 20
export const SKILL_LIST_RESULT_MAX_TOKENS = 2_000
export const SKILL_LIST_QUERY_MAX_CODE_POINTS = 256
export const SKILL_LIST_QUERY_MAX_BYTES = 1_024
export const SKILL_LIST_CURSOR_MAX_BYTES = 1_024

const SKILL_ROUTING_PROJECTION_VERSION = 2
const SKILL_LIST_CURSOR_VERSION = 1
const SKILL_SEARCH_METADATA_MAX_VALUES = 128
const SKILL_SEARCH_METADATA_VALUE_MAX_CODE_POINTS = 256
const SKILL_ROUTING_NON_MONOTONIC_SCAN_CAPS = 32
const SKILL_ROUTING_NORMALIZATION_INPUT_MULTIPLIER = 4
const SKILL_ROUTING_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export interface SkillRoutingCard {
  readonly name: string
  readonly summary: string
  readonly category?: string
  readonly platforms?: readonly string[]
  readonly sessionActive: boolean
}

export type SkillRoutingCatalogMode = 'full' | 'summary' | 'name_only' | 'omitted' | 'absent'

export interface SkillRoutingCatalogReport {
  readonly mode: SkillRoutingCatalogMode
  readonly budgetTokens: number
  readonly estimatedTokens: number
  readonly includedNames: readonly string[]
  readonly nameOnlyNames: readonly string[]
  readonly omittedNames: readonly string[]
  readonly summaryCodePointCap?: number
}

export interface SkillRoutingCatalogProjection {
  readonly content: string
  readonly report: SkillRoutingCatalogReport
}

type SkillSearchRecord = {
  card: SkillRoutingCard
  normalizedName: string
  normalizedCategory: string
  normalizedAliases: readonly string[]
  normalizedSummary: string
}

type SkillListCursor = {
  v: typeof SKILL_LIST_CURSOR_VERSION
  q: string
  f: string
  o: number
}

type SignedSkillListCursor = SkillListCursor & {
  s: string
}

const SKILL_LIST_CURSOR_HMAC_KEY = randomBytes(32)

function compareBinaryText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizeIdentity(value: unknown): string {
  if (typeof value !== 'string') return ''
  return collapseWhitespace(value.normalize('NFC'))
}

function collapseWhitespace(value: string): string {
  return value.replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim()
}

function truncateCodePointArray(codePoints: readonly string[], maxCodePoints: number): string {
  if (maxCodePoints <= 0 || codePoints.length === 0) return ''
  if (codePoints.length <= maxCodePoints) return codePoints.join('')
  if (maxCodePoints === 1) return '…'
  const prefix = codePoints
    .slice(0, maxCodePoints - 2)
    .join('')
    .trimEnd()
  return prefix ? `${prefix} …` : '…'
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  if (maxCodePoints <= 0 || !value) return ''
  const codePoints: string[] = []
  for (const codePoint of value) {
    codePoints.push(codePoint)
    if (codePoints.length > maxCodePoints) break
  }
  if (codePoints.length <= maxCodePoints) return codePoints.join('')
  return truncateCodePointArray(codePoints, maxCodePoints)
}

function takeCodePointPrefix(
  value: string,
  maxCodePoints: number
): { prefix: string; truncated: boolean } {
  let codePointCount = 0
  let end = 0
  for (const codePoint of value) {
    if (codePointCount >= maxCodePoints) {
      return { prefix: value.slice(0, end), truncated: true }
    }
    codePointCount += 1
    end += codePoint.length
  }
  return { prefix: value, truncated: false }
}

function normalizeBoundedText(value: unknown, maxCodePoints: number): string {
  if (typeof value !== 'string') return ''
  const source = takeCodePointPrefix(
    value,
    Math.max(maxCodePoints + 1, maxCodePoints * SKILL_ROUTING_NORMALIZATION_INPUT_MULTIPLIER)
  )
  const boundedSource = source.truncated ? `${source.prefix} …` : source.prefix
  return truncateCodePoints(collapseWhitespace(boundedSource.normalize('NFC')), maxCodePoints)
}

function countCodePoints(value: string): number {
  let count = 0
  for (const _codePoint of value) count += 1
  return count
}

function normalizePlatforms(
  platforms: readonly string[] | undefined
): readonly string[] | undefined {
  const normalized = [
    ...new Set(
      (platforms ?? [])
        .slice(0, SKILL_ROUTING_PLATFORM_MAX_COUNT)
        .map((platform) => normalizeBoundedText(platform, SKILL_ROUTING_PLATFORM_MAX_CODE_POINTS))
        .filter(Boolean)
    )
  ].sort(compareBinaryText)
  return normalized.length > 0 ? Object.freeze(normalized) : undefined
}

export function projectSkillRoutingCards(
  skills: readonly Pick<SkillMetadata, 'name' | 'description' | 'category' | 'platforms'>[],
  sessionActiveSkillNames: readonly string[] = []
): SkillRoutingCard[] {
  const sessionActiveSet = new Set(
    sessionActiveSkillNames.map(normalizeIdentity).filter((name) => name.length > 0)
  )
  const cardsByName = new Map<string, SkillRoutingCard>()
  for (const skill of skills) {
    const name = normalizeIdentity(skill.name)
    if (!name || name.length > SKILL_NAME_MAX_LENGTH || !SKILL_ROUTING_NAME_PATTERN.test(name)) {
      continue
    }
    const category = normalizeBoundedText(skill.category, SKILL_ROUTING_CATEGORY_MAX_CODE_POINTS)
    const platforms = normalizePlatforms(skill.platforms)
    const card: SkillRoutingCard = Object.freeze({
      name,
      summary: normalizeBoundedText(skill.description, SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS),
      ...(category ? { category } : {}),
      ...(platforms ? { platforms } : {}),
      sessionActive: sessionActiveSet.has(name)
    })
    if (!cardsByName.has(name)) {
      cardsByName.set(name, card)
    }
  }
  return [...cardsByName.values()].sort(
    (left, right) =>
      compareBinaryText(left.category ?? '', right.category ?? '') ||
      compareBinaryText(left.name, right.name)
  )
}

export function resolveSkillRoutingCatalogBudget(contextLength?: number): number {
  if (!Number.isFinite(contextLength) || (contextLength ?? 0) <= 0) {
    return SKILL_ROUTING_CATALOG_MAX_TOKENS
  }
  return Math.max(
    0,
    Math.min(
      Math.floor((contextLength as number) * SKILL_ROUTING_CATALOG_CONTEXT_RATIO),
      SKILL_ROUTING_CATALOG_MAX_TOKENS
    )
  )
}

function escapeCatalogText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderCatalogLine(
  card: SkillRoutingCard,
  options: { summaryCodePointCap: number; includeDetails: boolean },
  summaryCodePoints: Map<SkillRoutingCard, readonly string[]>
): string {
  const name = escapeCatalogText(card.name)
  if (card.sessionActive || options.summaryCodePointCap <= 0 || !card.summary) {
    return `- ${name}`
  }

  let codePoints = summaryCodePoints.get(card)
  if (!codePoints) {
    codePoints = Object.freeze(Array.from(card.summary))
    summaryCodePoints.set(card, codePoints)
  }
  const summary = escapeCatalogText(
    codePoints.length <= options.summaryCodePointCap
      ? card.summary
      : truncateCodePointArray(codePoints, options.summaryCodePointCap)
  )
  const details: string[] = []
  if (options.includeDetails && card.category) {
    details.push(`category=${escapeCatalogText(card.category)}`)
  }
  if (options.includeDetails && card.platforms?.length) {
    details.push(`platforms=${card.platforms.map(escapeCatalogText).join(',')}`)
  }
  const suffix = details.length > 0 ? ` [${details.join('; ')}]` : ''
  return `- ${name}: ${summary}${suffix}`
}

function wrapCatalogLines(lines: readonly string[]): string {
  return ['<available_skills>', ...lines, '</available_skills>'].join('\n')
}

function estimateTokens(value: string): number {
  return approximateTokenSize(value)
}

function buildCatalogProjection(
  content: string,
  input: {
    mode: SkillRoutingCatalogMode
    budgetTokens: number
    included: readonly SkillRoutingCard[]
    nameOnly: readonly SkillRoutingCard[]
    omitted: readonly SkillRoutingCard[]
    summaryCodePointCap?: number
  }
): SkillRoutingCatalogProjection {
  return Object.freeze({
    content,
    report: Object.freeze({
      mode: input.mode,
      budgetTokens: input.budgetTokens,
      estimatedTokens: estimateTokens(content),
      includedNames: Object.freeze(input.included.map((card) => card.name)),
      nameOnlyNames: Object.freeze(input.nameOnly.map((card) => card.name)),
      omittedNames: Object.freeze(input.omitted.map((card) => card.name)),
      ...(input.summaryCodePointCap === undefined
        ? {}
        : { summaryCodePointCap: input.summaryCodePointCap })
    })
  })
}

function fitsBudget(content: string, budgetTokens: number): boolean {
  return estimateTokens(content) <= budgetTokens
}

const CATALOG_OPEN = '<available_skills>'
const CATALOG_CLOSE = '</available_skills>'
const CATALOG_WRAPPER_TOKENS = estimateTokens(CATALOG_OPEN) + estimateTokens(CATALOG_CLOSE)

function renderCatalogCandidate(
  cards: readonly SkillRoutingCard[],
  options: { summaryCodePointCap: number; includeDetails: boolean },
  budgetTokens: number,
  summaryCodePoints: Map<SkillRoutingCard, readonly string[]>
): string | null {
  let estimatedTokens = CATALOG_WRAPPER_TOKENS
  const lines: string[] = []
  for (const card of cards) {
    const line = renderCatalogLine(card, options, summaryCodePoints)
    estimatedTokens += estimateTokens(line)
    if (estimatedTokens > budgetTokens) return null
    lines.push(line)
  }
  const content = wrapCatalogLines(lines)
  return fitsBudget(content, budgetTokens) ? content : null
}

function selectFittingCodePointCap<T>(
  minimumCap: number,
  maximumCap: number,
  evaluate: (cap: number) => T | null
): { cap: number; value: T } | null {
  const evaluated = new Map<number, T | null>()
  const evaluateOnce = (cap: number): T | null => {
    if (evaluated.has(cap)) return evaluated.get(cap) ?? null
    const value = evaluate(cap)
    evaluated.set(cap, value)
    return value
  }

  let lower = minimumCap
  let upper = maximumCap
  let best: { cap: number; value: T } | null = null
  while (lower <= upper) {
    const cap = Math.floor((lower + upper) / 2)
    const value = evaluateOnce(cap)
    if (value !== null) {
      best = { cap, value }
      lower = cap + 1
    } else {
      upper = cap - 1
    }
  }

  const scanFloor = best ? best.cap + 1 : minimumCap
  const scanCeiling = Math.min(
    maximumCap,
    (best?.cap ?? minimumCap - 1) + SKILL_ROUTING_NON_MONOTONIC_SCAN_CAPS
  )
  for (let cap = scanCeiling; cap >= scanFloor; cap -= 1) {
    const value = evaluateOnce(cap)
    if (value !== null) return { cap, value }
  }
  return best
}

export function renderSkillRoutingCatalogWithinBudget(
  cards: readonly SkillRoutingCard[],
  budgetTokens: number
): SkillRoutingCatalogProjection {
  const budget = Number.isFinite(budgetTokens) ? Math.max(0, Math.floor(budgetTokens)) : 0
  const normalizedCards = cards
  const summaryCodePoints = new Map<SkillRoutingCard, readonly string[]>()
  if (normalizedCards.length === 0) {
    const emptyCatalog = wrapCatalogLines(['(none)'])
    return fitsBudget(emptyCatalog, budget)
      ? buildCatalogProjection(emptyCatalog, {
          mode: 'full',
          budgetTokens: budget,
          included: [],
          nameOnly: [],
          omitted: []
        })
      : buildCatalogProjection('', {
          mode: 'absent',
          budgetTokens: budget,
          included: [],
          nameOnly: [],
          omitted: []
        })
  }

  const fullCatalog = renderCatalogCandidate(
    normalizedCards,
    {
      summaryCodePointCap: SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS,
      includeDetails: true
    },
    budget,
    summaryCodePoints
  )
  if (fullCatalog !== null) {
    return buildCatalogProjection(fullCatalog, {
      mode: 'full',
      budgetTokens: budget,
      included: normalizedCards,
      nameOnly: normalizedCards.filter((card) => card.sessionActive || !card.summary),
      omitted: []
    })
  }

  const fittingSummary = selectFittingCodePointCap(
    1,
    SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS,
    (summaryCodePointCap) =>
      renderCatalogCandidate(
        normalizedCards,
        { summaryCodePointCap, includeDetails: false },
        budget,
        summaryCodePoints
      )
  )
  if (fittingSummary) {
    return buildCatalogProjection(fittingSummary.value, {
      mode: 'summary',
      budgetTokens: budget,
      included: normalizedCards,
      nameOnly: normalizedCards.filter((card) => card.sessionActive || !card.summary),
      omitted: [],
      summaryCodePointCap: fittingSummary.cap
    })
  }

  const nameOnlyCatalog = renderCatalogCandidate(
    normalizedCards,
    {
      summaryCodePointCap: 0,
      includeDetails: false
    },
    budget,
    summaryCodePoints
  )
  if (nameOnlyCatalog !== null) {
    return buildCatalogProjection(nameOnlyCatalog, {
      mode: 'name_only',
      budgetTokens: budget,
      included: normalizedCards,
      nameOnly: normalizedCards,
      omitted: []
    })
  }

  const renderOmissionMarker = (includedCount: number): string =>
    `(${normalizedCards.length - includedCount} more skills omitted; use skill_list to search)`
  const minimumMarker = renderOmissionMarker(0)
  if (CATALOG_WRAPPER_TOKENS + estimateTokens(minimumMarker) > budget) {
    return buildCatalogProjection('', {
      mode: 'absent',
      budgetTokens: budget,
      included: [],
      nameOnly: [],
      omitted: normalizedCards
    })
  }

  const includedLines: string[] = []
  let includedLineTokens = 0
  for (let index = 0; index < normalizedCards.length - 1; index += 1) {
    const line = renderCatalogLine(
      normalizedCards[index],
      { summaryCodePointCap: 0, includeDetails: false },
      summaryCodePoints
    )
    const nextLineTokens = includedLineTokens + estimateTokens(line)
    const marker = renderOmissionMarker(index + 1)
    if (CATALOG_WRAPPER_TOKENS + nextLineTokens + estimateTokens(marker) > budget) break
    includedLines.push(line)
    includedLineTokens = nextLineTokens
  }
  const includedCount = includedLines.length
  const included = normalizedCards.slice(0, includedCount)
  const omitted = normalizedCards.slice(includedCount)
  const content = wrapCatalogLines([...includedLines, renderOmissionMarker(includedCount)])
  return fitsBudget(content, budget)
    ? buildCatalogProjection(content, {
        mode: 'omitted',
        budgetTokens: budget,
        included,
        nameOnly: included,
        omitted
      })
    : buildCatalogProjection('', {
        mode: 'absent',
        budgetTokens: budget,
        included: [],
        nameOnly: [],
        omitted: normalizedCards
      })
}

export function renderSkillRoutingCatalog(
  cards: readonly SkillRoutingCard[],
  contextLength?: number
): SkillRoutingCatalogProjection {
  return renderSkillRoutingCatalogWithinBudget(
    cards,
    resolveSkillRoutingCatalogBudget(contextLength)
  )
}

function normalizeSearchText(value: string): string {
  return collapseWhitespace(value.normalize('NFC')).toLowerCase()
}

function readSearchMetadataValues(metadata: Record<string, unknown> | undefined): string[] {
  const result: string[] = []
  for (const key of ['aliases', 'keywords', 'tags']) {
    const value = metadata?.[key]
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    for (const candidate of values.slice(0, SKILL_SEARCH_METADATA_MAX_VALUES - result.length)) {
      if (result.length >= SKILL_SEARCH_METADATA_MAX_VALUES) return result
      const normalized = normalizeBoundedText(
        candidate,
        SKILL_SEARCH_METADATA_VALUE_MAX_CODE_POINTS
      )
      if (normalized) result.push(normalizeSearchText(normalized))
    }
  }
  return [...new Set(result)].sort(compareBinaryText)
}

function buildSearchRecords(
  skills: readonly SkillMetadata[],
  sessionActiveSkillNames: readonly string[],
  query: string
): SkillSearchRecord[] {
  const cardByName = new Map(
    projectSkillRoutingCards(skills, sessionActiveSkillNames).map((card) => [card.name, card])
  )
  const metadataByName = new Map<string, SkillMetadata>()
  for (const skill of skills) {
    const name = normalizeIdentity(skill.name)
    if (!name || metadataByName.has(name)) continue
    metadataByName.set(name, skill)
  }
  return [...cardByName.values()].map((card) => {
    const metadata = metadataByName.get(card.name)
    return {
      card,
      normalizedName: normalizeSearchText(card.name),
      normalizedCategory: normalizeSearchText(card.category ?? ''),
      normalizedAliases: query ? readSearchMetadataValues(metadata?.metadata) : [],
      normalizedSummary: query ? normalizeSearchText(card.summary) : ''
    }
  })
}

function scoreSearchRecord(record: SkillSearchRecord, query: string): number | null {
  if (!query) return 0
  if (record.normalizedName === query) return 0
  if (record.normalizedName.startsWith(query)) return 1
  if (record.normalizedAliases.some((value) => value.includes(query))) return 2
  if (record.normalizedCategory.includes(query)) return 3
  if (record.normalizedSummary.includes(query)) return 4
  return null
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function buildCatalogFingerprint(records: readonly SkillSearchRecord[]): string {
  const hash = createHash('sha256')
  const updateField = (value: string): void => {
    const bytes = Buffer.from(value, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.length)
    hash.update(length)
    hash.update(bytes)
  }
  updateField(`skill-routing-v${SKILL_ROUTING_PROJECTION_VERSION}`)
  for (const record of records) {
    updateField(record.card.name)
    updateField(record.card.summary)
    updateField(record.card.category ?? '')
    updateField(String(record.card.platforms?.length ?? 0))
    for (const platform of record.card.platforms ?? []) updateField(platform)
    updateField(record.card.sessionActive ? '1' : '0')
    updateField(String(record.normalizedAliases.length))
    for (const alias of record.normalizedAliases) updateField(alias)
  }
  return hash.digest('hex')
}

function encodeCursor(input: Omit<SkillListCursor, 'v'>): string {
  const payload = { v: SKILL_LIST_CURSOR_VERSION, ...input } satisfies SkillListCursor
  const signature = createHmac('sha256', SKILL_LIST_CURSOR_HMAC_KEY)
    .update(JSON.stringify(payload), 'utf8')
    .digest('base64url')
  return Buffer.from(
    JSON.stringify({ ...payload, s: signature } satisfies SignedSkillListCursor)
  ).toString('base64url')
}

function decodeCursor(
  cursor: string | undefined,
  expectedQueryHash: string,
  expectedFingerprint: string
): number {
  if (!cursor) return 0
  if (Buffer.byteLength(cursor, 'utf8') > SKILL_LIST_CURSOR_MAX_BYTES) {
    throw new RangeError('skill_list cursor is too large.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new TypeError('skill_list cursor is invalid.')
  }
  let parsed: unknown
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) {
      throw new TypeError('skill_list cursor is not canonical.')
    }
    parsed = JSON.parse(decoded.toString('utf8'))
  } catch {
    throw new TypeError('skill_list cursor is invalid.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('skill_list cursor is invalid.')
  }
  const value = parsed as Record<string, unknown>
  if (
    Object.keys(value).sort().join(',') !== 'f,o,q,s,v' ||
    value.v !== SKILL_LIST_CURSOR_VERSION ||
    typeof value.q !== 'string' ||
    typeof value.f !== 'string' ||
    typeof value.s !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(value.s) ||
    value.q !== expectedQueryHash ||
    value.f !== expectedFingerprint ||
    !Number.isSafeInteger(value.o) ||
    (value.o as number) < 0
  ) {
    throw new TypeError('skill_list cursor does not match the current query and catalog.')
  }
  const payload = {
    v: value.v,
    q: value.q,
    f: value.f,
    o: value.o as number
  } satisfies SkillListCursor
  const expectedSignature = createHmac('sha256', SKILL_LIST_CURSOR_HMAC_KEY)
    .update(JSON.stringify(payload), 'utf8')
    .digest()
  const actualSignature = Buffer.from(value.s, 'base64url')
  if (
    actualSignature.length !== expectedSignature.length ||
    actualSignature.toString('base64url') !== value.s ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new TypeError('skill_list cursor signature is invalid.')
  }
  return value.o as number
}

function normalizeSkillListQuery(query: string | undefined): string {
  const source = query ?? ''
  if (source.length > SKILL_LIST_QUERY_MAX_BYTES) {
    throw new RangeError(`skill_list query exceeds ${SKILL_LIST_QUERY_MAX_BYTES} UTF-8 bytes.`)
  }
  if (Buffer.byteLength(source, 'utf8') > SKILL_LIST_QUERY_MAX_BYTES) {
    throw new RangeError(`skill_list query exceeds ${SKILL_LIST_QUERY_MAX_BYTES} UTF-8 bytes.`)
  }
  const normalized = collapseWhitespace(source.normalize('NFC')).toLowerCase()
  if (countCodePoints(normalized) > SKILL_LIST_QUERY_MAX_CODE_POINTS) {
    throw new RangeError(
      `skill_list query exceeds ${SKILL_LIST_QUERY_MAX_CODE_POINTS} Unicode characters.`
    )
  }
  if (Buffer.byteLength(normalized, 'utf8') > SKILL_LIST_QUERY_MAX_BYTES) {
    throw new RangeError(`skill_list query exceeds ${SKILL_LIST_QUERY_MAX_BYTES} UTF-8 bytes.`)
  }
  return normalized
}

function normalizeSkillListLimit(limit: number | undefined): number {
  if (limit === undefined) return SKILL_LIST_DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SKILL_LIST_MAX_LIMIT) {
    throw new RangeError(`skill_list limit must be between 1 and ${SKILL_LIST_MAX_LIMIT}.`)
  }
  return limit
}

function toSkillListItem(
  card: SkillRoutingCard,
  activeSkillNames: ReadonlySet<string>,
  summaryCodePointCap: number
): SkillListItem {
  const description = truncateCodePoints(card.summary, summaryCodePointCap)
  return {
    name: card.name,
    ...(description ? { description } : {}),
    ...(card.category ? { category: card.category } : {}),
    ...(card.platforms?.length ? { platforms: [...card.platforms] } : {}),
    sessionActive: card.sessionActive,
    activeForExecution: card.sessionActive || activeSkillNames.has(card.name),
    isPinned: card.sessionActive,
    active: card.sessionActive || activeSkillNames.has(card.name)
  }
}

export function buildSkillListResult(
  skills: readonly SkillMetadata[],
  sessionActiveSkillNames: readonly string[],
  activeSkillNames: readonly string[],
  input: SkillListInput = {}
): SkillListResult {
  const query = normalizeSkillListQuery(input.query)
  const limit = normalizeSkillListLimit(input.limit)
  const activeSet = new Set(activeSkillNames.map(normalizeIdentity).filter(Boolean))
  const records = buildSearchRecords(skills, sessionActiveSkillNames, query)
  const fingerprint = buildCatalogFingerprint(records)
  const queryHash = hashText(query)
  const offset = decodeCursor(input.cursor, queryHash, fingerprint)
  const ranked = query
    ? records
        .map((record) => ({ record, score: scoreSearchRecord(record, query) }))
        .filter(
          (candidate): candidate is { record: SkillSearchRecord; score: number } =>
            candidate.score !== null
        )
        .sort(
          (left, right) =>
            left.score - right.score ||
            compareBinaryText(left.record.card.category ?? '', right.record.card.category ?? '') ||
            compareBinaryText(left.record.card.name, right.record.card.name)
        )
        .map((candidate) => candidate.record)
    : records

  if (offset > ranked.length) {
    throw new RangeError('skill_list cursor offset is outside the current result set.')
  }
  const pageCandidates = ranked.slice(offset, offset + limit)
  const sessionActiveCount = records.filter((record) => record.card.sessionActive).length
  const activeForExecutionCount = records.filter(
    (record) => record.card.sessionActive || activeSet.has(record.card.name)
  ).length

  const buildResult = (count: number, summaryCodePointCap: number): SkillListResult => {
    const selected = pageCandidates.slice(0, count)
    const nextOffset = offset + selected.length
    const hasMore = nextOffset < ranked.length
    return {
      skills: selected.map((record) =>
        toSkillListItem(record.card, activeSet, summaryCodePointCap)
      ),
      sessionActiveCount,
      activeForExecutionCount,
      pinnedCount: sessionActiveCount,
      activeCount: activeForExecutionCount,
      totalCount: records.length,
      totalMatched: ranked.length,
      omittedCount: Math.max(0, ranked.length - nextOffset),
      ...(hasMore
        ? { nextCursor: encodeCursor({ q: queryHash, f: fingerprint, o: nextOffset }) }
        : {})
    }
  }

  for (let count = pageCandidates.length; count > 0; count -= 1) {
    const fittingResult = selectFittingCodePointCap(
      0,
      SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS,
      (summaryCodePointCap) => {
        const candidate = buildResult(count, summaryCodePointCap)
        return estimateTokens(JSON.stringify(candidate)) <= SKILL_LIST_RESULT_MAX_TOKENS
          ? candidate
          : null
      }
    )
    if (fittingResult) return fittingResult.value
  }

  if (pageCandidates.length > 0) {
    throw new RangeError('skill_list could not fit one routing card within its response budget.')
  }
  return buildResult(0, 0)
}
