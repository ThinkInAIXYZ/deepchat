import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { MemoryLifecycle } from '@shared/contracts/routes'
import MemoryLifecyclePanel from '../../../src/renderer/settings/components/MemoryLifecyclePanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key
  })
}))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span><slot /></span>'
  })
}))
vi.mock('@shadcn/components/ui/badge', () => ({
  Badge: defineComponent({
    name: 'Badge',
    template: '<span><slot /></span>'
  })
}))

const lifecycle: MemoryLifecycle = {
  memoryId: 'm1',
  kind: 'semantic',
  status: 'embedded',
  recallable: true,
  decayTier: 'archive_candidate',
  recall: {
    weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
    similarity: 0.3,
    similaritySource: 'baseline',
    recency: 0.8,
    importance: 0.5,
    confidenceFactor: 1,
    importanceFloor: 0.075,
    final: 0.455,
    flooredByImportance: true,
    halfLifeMs: 14 * 24 * 60 * 60 * 1000
  },
  forget: {
    anchorAt: 1000,
    ageDays: 120,
    halfLifeDays: 45,
    decayScore: 0.03,
    materializedDecay: 0.04,
    materializedStale: true
  },
  archiveEligibility: {
    eligible: true,
    oldEnough: true,
    decayedEnough: true,
    neverAccessed: true,
    active: true,
    exempt: false,
    exemptReasons: [],
    gaps: {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getLifecycleMessages(settings: unknown): unknown {
  if (!isRecord(settings)) return undefined
  const deepchatAgents = settings.deepchatAgents
  if (!isRecord(deepchatAgents)) return undefined
  const memoryManager = deepchatAgents.memoryManager
  if (!isRecord(memoryManager)) return undefined
  return memoryManager.lifecycle
}

function collectStrings(
  value: unknown,
  path = 'lifecycle',
  entries: Array<{ path: string; value: string }> = []
): Array<{ path: string; value: string }> {
  if (typeof value === 'string') {
    entries.push({ path, value })
    return entries
  }

  if (!isRecord(value)) return entries

  for (const [key, child] of Object.entries(value)) {
    collectStrings(child, `${path}.${key}`, entries)
  }

  return entries
}

describe('MemoryLifecyclePanel', () => {
  it('renders lifecycle score groups and archive eligibility', () => {
    const wrapper = mount(MemoryLifecyclePanel, {
      props: { lifecycle, loading: false, error: null }
    })

    const text = wrapper.text()
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.tier.archive_candidate')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.final')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.floored')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.forget.materialized')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.forget.stale')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.archive.eligible')
  })

  it('keeps lifecycle locale strings free of review-model terms', () => {
    const localeRoot = join(process.cwd(), 'src/renderer/src/i18n')
    const bannedPatterns = [
      /\breview\b/i,
      /\bnext review\b/i,
      /\breview interval\b/i,
      /\breinforcement\b/i,
      /\bpromotion\b/i,
      /复习|晋级|回顾|下一次|倒计时/
    ]
    const failures: string[] = []

    for (const localeDir of readdirSync(localeRoot, { withFileTypes: true })) {
      if (!localeDir.isDirectory()) continue
      const locale = localeDir.name
      const settingsPath = join(localeRoot, locale, 'settings.json')
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown
      const lifecycleMessages = getLifecycleMessages(settings)

      expect(lifecycleMessages, `${locale} lifecycle messages`).toBeDefined()

      for (const entry of collectStrings(lifecycleMessages)) {
        for (const pattern of bannedPatterns) {
          if (pattern.test(entry.value)) {
            failures.push(`${locale}.${entry.path}: ${entry.value}`)
          }
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('does not render recall breakdown for persona lifecycle rows', () => {
    const persona = {
      ...lifecycle,
      kind: 'persona',
      recallable: false,
      recall: null,
      decayTier: 'stale',
      archiveEligibility: {
        ...lifecycle.archiveEligibility,
        eligible: false,
        exempt: true,
        exemptReasons: ['persona']
      }
    } satisfies MemoryLifecycle

    const wrapper = mount(MemoryLifecyclePanel, {
      props: { lifecycle: persona, loading: false, error: null }
    })

    expect(wrapper.text()).toContain(
      'settings.deepchatAgents.memoryManager.lifecycle.recall.notRecallable'
    )
    expect(wrapper.text()).not.toContain(
      'settings.deepchatAgents.memoryManager.lifecycle.recall.final'
    )
  })

  it('marks inactive rows as diagnostic instead of directly recallable', () => {
    const archived = {
      ...lifecycle,
      status: 'archived',
      recallable: false,
      archiveEligibility: {
        ...lifecycle.archiveEligibility,
        eligible: false,
        active: false
      }
    } satisfies MemoryLifecycle

    const wrapper = mount(MemoryLifecyclePanel, {
      props: { lifecycle: archived, loading: false, error: null }
    })
    const text = wrapper.text()

    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.inactive')
    expect(text).toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.diagnosticFinal')
    expect(text).not.toContain('settings.deepchatAgents.memoryManager.lifecycle.recall.final')
  })
})
