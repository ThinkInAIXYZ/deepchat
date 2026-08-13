import { approximateTokenSize } from 'tokenx'
import { describe, expect, it } from 'vitest'
import type { SkillMetadata } from '../../../src/shared/types/skill'
import { SKILL_NAME_MAX_LENGTH } from '../../../src/shared/types/skill'
import {
  SKILL_ROUTING_CATEGORY_MAX_CODE_POINTS,
  SKILL_LIST_RESULT_MAX_TOKENS,
  SKILL_ROUTING_DESCRIPTION_MAX_BYTES,
  SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS,
  SKILL_ROUTING_PLATFORM_MAX_CODE_POINTS,
  buildSkillListResult,
  projectSkillRoutingCards,
  renderSkillRoutingCatalogWithinBudget
} from '../../../src/main/skill/routingCatalog'

function metadata(
  name: string,
  description: string,
  overrides: Partial<SkillMetadata> = {}
): SkillMetadata {
  return {
    name,
    description,
    path: `/skills/${name}/SKILL.md`,
    skillRoot: `/skills/${name}`,
    ...overrides
  }
}

describe('skill routing catalog', () => {
  it('keeps every rendered catalog inside the assigned token budget', () => {
    const cards = projectSkillRoutingCards(
      Array.from({ length: 200 }, (_, index) =>
        metadata(
          `skill-${index.toString().padStart(3, '0')}`,
          `Description ${index} ${'large routing description '.repeat(100)}`,
          { category: `category-${index % 5}` }
        )
      )
    )

    for (const budget of [0, 40, 80, 160, 500, 2_000]) {
      const projection = renderSkillRoutingCatalogWithinBudget(cards, budget)
      expect(approximateTokenSize(projection.content)).toBeLessThanOrEqual(budget)
      expect(projection.report.estimatedTokens).toBe(approximateTokenSize(projection.content))
    }
  })

  it('uses stable category/name ordering and stable bytes', () => {
    const source = [
      metadata('zeta', 'Z', { category: 'two' }),
      metadata('beta', 'B', { category: 'one' }),
      metadata('alpha', 'A', { category: 'one' })
    ]
    const first = renderSkillRoutingCatalogWithinBudget(projectSkillRoutingCards(source), 2_000)
    const second = renderSkillRoutingCatalogWithinBudget(
      projectSkillRoutingCards([...source].reverse()),
      2_000
    )

    expect(first.content).toBe(second.content)
    expect(first.report.includedNames).toEqual(['alpha', 'beta', 'zeta'])
  })

  it('caps descriptions by Unicode code point without splitting surrogate pairs', () => {
    const [card] = projectSkillRoutingCards([
      metadata('unicode', `${'😀'.repeat(SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS)}tail`)
    ])

    expect(Array.from(card.summary)).toHaveLength(SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS)
    expect(card.summary.endsWith('…')).toBe(true)
    expect(card.summary).not.toMatch(
      /[\uD800-\uDFFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
    )
  })

  it('applies field caps after NFC expansion', () => {
    const [card] = projectSkillRoutingCards([
      metadata('unicode-expansion', '\u0344'.repeat(2_000), {
        category: '\u0344'.repeat(300),
        platforms: ['\u0344'.repeat(200)]
      })
    ])

    expect(Array.from(card.summary)).toHaveLength(SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS)
    expect(Array.from(card.category ?? '')).toHaveLength(SKILL_ROUTING_CATEGORY_MAX_CODE_POINTS)
    expect(Array.from(card.platforms?.[0] ?? '')).toHaveLength(
      SKILL_ROUTING_PLATFORM_MAX_CODE_POINTS
    )
  })

  it('recovers a nearby fitting cap across non-monotonic token estimates', () => {
    const description =
      'é - 中a.😀中-1é__😀 éé aé-😀 -a _a中 aé- 中 1é .1 -. 😀中😀 - …中😀_- ' +
      '1…1… …..-…a.a …aa1é. a_é.1.中 é 中1- a-a中a … é__.a……-… -_中1…_é😀_-…1a ' +
      'a.1中__… 1中 1.1 中_é1éé😀… -😀😀 .. _---😀_中é😀 - -😀中…. éé 中-a-_11 …_ ' +
      '-.é.-..😀.中_ 😀😀1中a é-😀a中…😀a中a.1éé.…a_-😀中._.é …😀😀a-…-é… éé.1a ' +
      '.中_1é_中- 😀1é - 😀aé - é……- a .中 1 _-'
    const cards = projectSkillRoutingCards([
      metadata('weird', description, { category: 'x'.repeat(128) })
    ])
    const projection = renderSkillRoutingCatalogWithinBudget(cards, 86)

    expect(projection.report.mode).toBe('summary')
    expect(projection.report.summaryCodePointCap).toBeGreaterThan(0)
    expect(projection.report.summaryCodePointCap).toBeLessThan(
      SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS
    )
    expect(approximateTokenSize(projection.content)).toBeLessThanOrEqual(86)
  })

  it('rejects invalid source names and guarantees accepted name-only cards fit', () => {
    const validName = `a${'b'.repeat(SKILL_NAME_MAX_LENGTH - 1)}`
    const invalidName = `a${'b'.repeat(SKILL_NAME_MAX_LENGTH)}`
    const cards = projectSkillRoutingCards([
      metadata(validName, 'valid'),
      metadata(invalidName, 'invalid')
    ])
    const result = buildSkillListResult(
      [metadata(validName, 'valid'), metadata(invalidName, 'invalid')],
      [],
      [],
      { limit: 1 }
    )

    expect(cards.map((card) => card.name)).toEqual([validName])
    expect(result.skills.map((skill) => skill.name)).toEqual([validName])
    expect(result.nextCursor).toBeUndefined()
  })

  it('allows the whole catalog block to disappear for a tiny budget', () => {
    const projection = renderSkillRoutingCatalogWithinBudget(
      projectSkillRoutingCards([metadata('one', 'One')]),
      1
    )

    expect(projection.content).toBe('')
    expect(projection.report.mode).toBe('absent')
    expect(projection.report.omittedNames).toEqual(['one'])
  })

  it('searches bounded routing descriptions without retaining oversized tails', () => {
    const skills = [
      metadata('database-safety', `rollback-protocol ${'😀'.repeat(1_000_000)} private-tail`, {
        path: '/private/database-safety/SKILL.md',
        skillRoot: '/private/database-safety',
        metadata: { secret: 'do-not-return', tags: ['database'] },
        allowedTools: ['exec']
      })
    ]

    const result = buildSkillListResult(skills, [], [], {
      query: 'rollback-protocol'
    })
    const serialized = JSON.stringify(result)

    expect(result.skills.map((skill) => skill.name)).toEqual(['database-safety'])
    expect(serialized).not.toContain('/private')
    expect(serialized).not.toContain('do-not-return')
    expect(serialized).not.toContain('allowedTools')
    expect(approximateTokenSize(serialized)).toBeLessThanOrEqual(SKILL_LIST_RESULT_MAX_TOKENS)
    expect(Buffer.byteLength(result.skills[0].description ?? '', 'utf8')).toBeLessThanOrEqual(
      SKILL_ROUTING_DESCRIPTION_MAX_BYTES
    )
    expect(buildSkillListResult(skills, [], [], { query: 'private-tail' }).skills).toEqual([])
  })

  it('ignores malformed descriptions defensively during queried discovery', () => {
    const malformed = {
      ...metadata('malformed', 'valid'),
      description: { text: 'not-a-string' }
    } as unknown as SkillMetadata

    expect(buildSkillListResult([malformed], [], [], { query: 'not' }).skills).toEqual([])
  })

  it('keeps every discovery page bounded for a large catalog', () => {
    const skills = Array.from({ length: 300 }, (_, index) =>
      metadata(`skill-${index}`, `Description ${'word '.repeat(2_000)}`)
    )
    const result = buildSkillListResult(skills, [], [], { limit: 20 })

    expect(result.skills.length).toBeGreaterThan(0)
    expect(result.skills.length).toBeLessThanOrEqual(20)
    expect(result.nextCursor).toBeTypeOf('string')
    expect(approximateTokenSize(JSON.stringify(result))).toBeLessThanOrEqual(
      SKILL_LIST_RESULT_MAX_TOKENS
    )
  })

  it('uses the documented lexical ranking tiers and normalized whitespace', () => {
    const skills = [
      metadata('sql', 'exact'),
      metadata('sql-helper', 'prefix'),
      metadata('alias-match', 'alias', { metadata: { aliases: ['sql'] } }),
      metadata('category-match', 'category', { category: 'sql' }),
      metadata('description-match', 'uses sql safely'),
      metadata('whitespace-match', 'data\n\tmigration guide')
    ]

    expect(
      buildSkillListResult(skills, [], [], { query: 'sql', limit: 20 }).skills.map(
        (skill) => skill.name
      )
    ).toEqual(['sql', 'sql-helper', 'alias-match', 'category-match', 'description-match'])
    expect(
      buildSkillListResult(skills, [], [], { query: 'data migration' }).skills.map(
        (skill) => skill.name
      )
    ).toEqual(['whitespace-match'])
  })

  it('invalidates cursors for adversarially framed search-corpus changes', () => {
    const sharedPrefix = 'p'.repeat(SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS + 10)
    const firstCatalog = [
      metadata('first', `${sharedPrefix}x\0y`, { metadata: { aliases: ['z'] } }),
      metadata('second', 'p second')
    ]
    const secondCatalog = [
      metadata('first', `${sharedPrefix}x`, { metadata: { aliases: ['y', 'z'] } }),
      metadata('second', 'p second')
    ]
    const firstPage = buildSkillListResult(firstCatalog, [], [], { query: 'p', limit: 1 })

    expect(firstPage.nextCursor).toBeTypeOf('string')
    expect(() =>
      buildSkillListResult(secondCatalog, [], [], {
        query: 'p',
        cursor: firstPage.nextCursor,
        limit: 1
      })
    ).toThrow('does not match the current query and catalog')
  })

  it('invalidates search cursors when a metadata object changes in place', () => {
    const first = metadata('first', 'needle first version')
    const skills = [first, metadata('second', 'needle second')]
    const firstPage = buildSkillListResult(skills, [], [], { query: 'needle', limit: 1 })

    expect(firstPage.nextCursor).toBeTypeOf('string')
    expect(buildSkillListResult(skills, [], [], { query: 'needle', limit: 1 }).skills).toEqual(
      firstPage.skills
    )

    first.description = 'needle revised version'

    expect(() =>
      buildSkillListResult(skills, [], [], {
        query: 'needle',
        cursor: firstPage.nextCursor,
        limit: 1
      })
    ).toThrow('does not match the current query and catalog')
  })

  it('keeps cursors valid when only an unsearchable description tail changes', () => {
    const searchablePrefix = `needle ${'p'.repeat(SKILL_ROUTING_DESCRIPTION_MAX_CODE_POINTS)}`
    const first = metadata('first', `${searchablePrefix} first-tail`)
    const skills = [first, metadata('second', 'needle second')]
    const firstPage = buildSkillListResult(skills, [], [], { query: 'needle', limit: 1 })

    expect(firstPage.nextCursor).toBeTypeOf('string')
    first.description = `${searchablePrefix} revised-tail`

    expect(
      buildSkillListResult(skills, [], [], {
        query: 'needle',
        cursor: firstPage.nextCursor,
        limit: 1
      }).skills.map((skill) => skill.name)
    ).toEqual(['second'])
  })

  it('bounds metadata candidate scanning and query normalization input', () => {
    const aliases = Array.from({ length: 129 }, (_, index) =>
      index === 128 ? 'hidden-tail' : index
    )
    const skill = metadata('bounded', 'bounded', { metadata: { aliases } })

    expect(buildSkillListResult([skill], [], [], { query: 'hidden-tail' }).skills).toEqual([])
    expect(() => buildSkillListResult([skill], [], [], { query: 'a'.repeat(1_025) })).toThrow(
      'query exceeds 1024 UTF-8 bytes'
    )
  })

  it('keeps cursors valid when execution-active discovery decoration changes', () => {
    const skills = [metadata('first', 'first'), metadata('second', 'second')]
    const firstPage = buildSkillListResult(skills, [], ['first'], { limit: 1 })

    expect(
      buildSkillListResult(skills, [], ['second'], {
        cursor: firstPage.nextCursor,
        limit: 1
      }).skills
    ).toEqual([
      expect.objectContaining({
        name: 'second',
        activeForExecution: true
      })
    ])
  })

  it('rejects non-canonical and offset-tampered cursors', () => {
    const skills = [
      metadata('first', 'first'),
      metadata('second', 'second'),
      metadata('third', 'third')
    ]
    const firstPage = buildSkillListResult(skills, [], [], { limit: 1 })
    const cursor = firstPage.nextCursor as string
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      o: number
    }
    payload.o = 2
    const tamperedCursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

    expect(() => buildSkillListResult(skills, [], [], { cursor: `${cursor}!`, limit: 1 })).toThrow(
      'cursor is invalid'
    )
    expect(() =>
      buildSkillListResult(skills, [], [], { cursor: tamperedCursor, limit: 1 })
    ).toThrow('cursor signature is invalid')
  })
})
