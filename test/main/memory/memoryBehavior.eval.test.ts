import { describe, expect, it } from 'vitest'

import { buildMemorySection } from '@/memory'
import type { MemoryDirectiveInput } from '@/memory/domain/directives'
import type { AgentMemoryKind, MemoryTemporalMetadata } from '@/memory/domain/types'
import fixtureValue from '../../fixtures/memory/behavior-v1.json'
import { makePresenter } from './support/memoryFakes'

type MemoryBehaviorAxis =
  | 'carry_forward'
  | 'preference_directive'
  | 'temporal'
  | 'correction_forgetting'

interface MemoryBehaviorRow {
  id: string
  kind: AgentMemoryKind
  content: string
  importance: number
  temporal?: MemoryTemporalMetadata
}

interface MemoryBehaviorReplayRow extends Omit<MemoryBehaviorRow, 'kind'> {
  kind: 'episodic' | 'semantic'
}

type MemoryBehaviorDirective = MemoryDirectiveInput & { state: 'active' | 'draft' }

interface MemoryBehaviorScenario {
  id: string
  axis: MemoryBehaviorAxis
  mode: 'working' | 'recall'
  query: string
  rows: MemoryBehaviorRow[]
  directives?: MemoryBehaviorDirective[]
  deleteIds?: string[]
  replayRows?: MemoryBehaviorReplayRow[]
  expected: {
    replayCreatedCount?: number
    selectedMemoryIds: string[]
    excludedMemoryIds: string[]
    sectionIncludes: string[]
    sectionExcludes: string[]
    directiveIncludes?: string[]
    directiveExcludes?: string[]
    annotationIncludes?: Record<string, string>
  }
}

interface MemoryBehaviorFixtureV1 {
  version: 1
  clock: { now: number; timeZone: string }
  scenarios: MemoryBehaviorScenario[]
}

const AXES: ReadonlySet<MemoryBehaviorAxis> = new Set([
  'carry_forward',
  'preference_directive',
  'temporal',
  'correction_forgetting'
])

function validateFixture(value: unknown): asserts value is MemoryBehaviorFixtureV1 {
  if (!value || typeof value !== 'object')
    throw new Error('memory behavior fixture must be an object')
  const fixture = value as Partial<MemoryBehaviorFixtureV1>
  if (fixture.version !== 1) throw new Error('memory behavior fixture version must be 1')
  if (
    !fixture.clock ||
    !Number.isFinite(fixture.clock.now) ||
    typeof fixture.clock.timeZone !== 'string' ||
    !fixture.clock.timeZone
  ) {
    throw new Error('memory behavior fixture requires a deterministic clock')
  }
  if (!Array.isArray(fixture.scenarios) || fixture.scenarios.length === 0) {
    throw new Error('memory behavior fixture requires scenarios')
  }
  const scenarioIds = new Set<string>()
  for (const scenario of fixture.scenarios) {
    if (!scenario.id || scenarioIds.has(scenario.id)) {
      throw new Error(`memory behavior scenario ID must be unique: ${scenario.id}`)
    }
    scenarioIds.add(scenario.id)
    if (!AXES.has(scenario.axis)) {
      throw new Error(`unknown memory behavior axis: ${String(scenario.axis)}`)
    }
    if (scenario.mode !== 'working' && scenario.mode !== 'recall') {
      throw new Error(`unknown memory behavior mode: ${String(scenario.mode)}`)
    }
    const rowIds = new Set(scenario.rows.map((row) => row.id))
    if (rowIds.size !== scenario.rows.length) {
      throw new Error(`memory behavior scenario has duplicate row IDs: ${scenario.id}`)
    }
    if (scenario.deleteIds?.some((id) => !rowIds.has(id))) {
      throw new Error(`memory behavior scenario deletes an unknown row: ${scenario.id}`)
    }
  }
  if (
    !fixture.scenarios.some(
      (scenario) => scenario.axis === 'preference_directive' && scenario.directives?.length
    )
  ) {
    throw new Error('preference/directive axis requires an explicit directive scenario')
  }
}

validateFixture(fixtureValue)
const fixture = fixtureValue as MemoryBehaviorFixtureV1

describe('agent memory behavior fixture v1', () => {
  it('covers every maintained behavior axis with a deterministic clock', () => {
    expect(new Set(fixture.scenarios.map((scenario) => scenario.axis))).toEqual(AXES)
    expect(fixture.clock).toEqual({ now: 2_000_000, timeZone: 'UTC' })
  })

  for (const scenario of fixture.scenarios) {
    it(`${scenario.axis}: ${scenario.id}`, async () => {
      const { presenter, repo } = makePresenter(
        {
          memoryEnabled: true,
          memoryEmbedding: null,
          memoryRetrieval: { topK: 10 }
        },
        undefined,
        {
          clock: {
            now: () => fixture.clock.now,
            timeZone: () => fixture.clock.timeZone
          }
        }
      )
      for (const row of scenario.rows) {
        repo.insert({
          ...row,
          agentId: 'behavior-agent',
          createdAt: fixture.clock.now - 1_000
        })
      }
      for (const id of scenario.deleteIds ?? []) {
        await expect(presenter.deleteMemory('behavior-agent', id)).resolves.toEqual({
          action: 'applied'
        })
      }
      for (const { state, ...directive } of scenario.directives ?? []) {
        if (state === 'active') {
          expect(presenter.createDirective('behavior-agent', directive)).not.toBeNull()
        } else {
          expect(presenter.suggestDirective('behavior-agent', directive)).not.toBeNull()
        }
      }
      const replayCreatedIds = presenter.writeMemoriesSync(
        (scenario.replayRows ?? []).map(({ kind, content, importance, temporal }) => ({
          kind,
          content,
          importance,
          temporal
        })),
        { agentId: 'behavior-agent' }
      )
      expect(replayCreatedIds).toHaveLength(scenario.expected.replayCreatedCount ?? 0)
      if (scenario.mode === 'working') presenter.refreshWorkingMemory('behavior-agent')

      const injection = await presenter.buildInjection('behavior-agent', scenario.query)
      const selected = injection?.payload.memories ?? []
      const selectedIds = selected.map((memory) => memory.id)
      const section = buildMemorySection(injection)
      const directiveSection = presenter.buildDirectiveContribution('behavior-agent').content ?? ''

      expect(new Set(selectedIds)).toEqual(new Set(scenario.expected.selectedMemoryIds))
      for (const id of scenario.expected.excludedMemoryIds) {
        expect(selectedIds).not.toContain(id)
      }
      for (const text of scenario.expected.sectionIncludes) expect(section).toContain(text)
      for (const text of scenario.expected.sectionExcludes) expect(section).not.toContain(text)
      for (const text of scenario.expected.directiveIncludes ?? []) {
        expect(directiveSection).toContain(text)
      }
      for (const text of scenario.expected.directiveExcludes ?? []) {
        expect(directiveSection).not.toContain(text)
      }
      for (const [id, text] of Object.entries(scenario.expected.annotationIncludes ?? {})) {
        expect(selected.find((memory) => memory.id === id)?.temporalAnnotation).toContain(text)
      }
    })
  }
})
