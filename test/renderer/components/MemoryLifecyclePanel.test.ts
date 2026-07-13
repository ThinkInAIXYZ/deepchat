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

interface SettingsJson {
  deepchatAgents?: {
    memoryManager?: {
      lifecycle?: unknown
      health?: { archivePrediction?: unknown }
    }
  }
}

type SettingsModule = SettingsJson | { default: SettingsJson }

const settingsModules = import.meta.glob<SettingsModule>(
  '../../../src/renderer/src/i18n/*/settings.json',
  { eager: true }
)

function resolveSettingsModule(module: SettingsModule): SettingsJson {
  if (module && typeof module === 'object' && 'default' in module) return module.default
  return module
}

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

function getMemoryManagerMessages(
  settings: unknown
): { lifecycle: unknown; archivePrediction: unknown } | undefined {
  if (!isRecord(settings)) return undefined
  const deepchatAgents = settings.deepchatAgents
  if (!isRecord(deepchatAgents)) return undefined
  const memoryManager = deepchatAgents.memoryManager
  if (!isRecord(memoryManager)) return undefined
  const health = memoryManager.health
  return {
    lifecycle: memoryManager.lifecycle,
    archivePrediction: isRecord(health) ? health.archivePrediction : undefined
  }
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

  it('keeps memory manager locale strings free of review-model terms', () => {
    const bannedPatterns = [
      /\breview\b/i,
      /\bnext review\b/i,
      /\breview interval\b/i,
      /\breinforcement\b/i,
      /\bpromotion\b/i,
      /复习|複習|晋级|晉級|回顾|回顧|下一次|倒计时|倒數/
    ]
    const failures: string[] = []

    if (Object.keys(settingsModules).length === 0) failures.push('missing locale modules')

    for (const [settingsPath, settingsModule] of Object.entries(settingsModules)) {
      const locale = settingsPath.match(/\/i18n\/([^/]+)\/settings\.json$/)?.[1] ?? settingsPath
      const settings = resolveSettingsModule(settingsModule)
      const memoryManagerMessages = getMemoryManagerMessages(settings)

      expect(memoryManagerMessages?.lifecycle, `${locale} lifecycle messages`).toBeDefined()
      expect(
        memoryManagerMessages?.archivePrediction,
        `${locale} archive prediction messages`
      ).toBeDefined()

      for (const entry of collectStrings(memoryManagerMessages, 'memoryManager')) {
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
