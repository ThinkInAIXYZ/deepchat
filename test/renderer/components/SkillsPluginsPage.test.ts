import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  configClient: {
    getSkillDraftSuggestionsEnabled: vi.fn(),
    setSkillDraftSuggestionsEnabled: vi.fn(),
    listAgents: vi.fn()
  },
  skillClient: {
    getAllSkills: vi.fn(),
    onCatalogChanged: vi.fn(),
    readSkillFile: vi.fn(),
    updateSkillFile: vi.fn(),
    deleteSkill: vi.fn(),
    setSkillAssigned: vi.fn()
  }
}))
let catalogChangedListener: (() => void) | undefined
const detailRequestClose = vi.fn()

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => mocks.configClient
}))
vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
}))
vi.mock('@/composables/useGuidedOnboardingStep', () => ({
  useGuidedOnboardingStep: () => ({
    showGuide: { value: false },
    stepIndex: { value: 1 },
    totalSteps: { value: 1 },
    currentStepId: { value: 'skills' },
    stepState: { value: null },
    canGoPrevious: { value: false },
    dismissGuide: vi.fn(),
    completeStep: vi.fn(),
    activatePreviousStep: vi.fn(),
    skipStep: vi.fn(),
    forceComplete: vi.fn()
  })
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ hasRoute: vi.fn(() => true), push: vi.fn() })
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<span />' })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot name="actions" /><slot /></div>'
  })

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const ButtonStub = defineComponent({
  name: 'DcButton',
  inheritAttrs: false,
  props: { disabled: Boolean },
  template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
})

const SkillCardStub = defineComponent({
  name: 'SkillCard',
  props: {
    skill: { type: Object, required: true },
    disabled: Boolean
  },
  emits: ['view'],
  template:
    '<button :data-testid="`plugin-skill-${skill.name}`" :disabled="disabled" @click="$emit(\'view\')">{{ skill.name }}</button>'
})

const SkillDetailDialogStub = defineComponent({
  name: 'SkillDetailDialog',
  props: {
    open: Boolean,
    name: String,
    agents: Array,
    enabledAgentIds: Array,
    enabledAgentNames: Array,
    agentUpdatePendingId: String
  },
  emits: ['update:open', 'enable-agent', 'disable-agent', 'delete'],
  setup(_props, { expose }) {
    expose({ requestClose: detailRequestClose })
  },
  template: `
    <div
      data-testid="detail-dialog"
      :data-open="String(open)"
      :data-name="name"
      :data-agent-options="agents?.map((agent) => agent.id).join(',')"
      :data-enabled-agents="enabledAgentIds?.join(',')"
      :data-enabled-agent-names="enabledAgentNames?.join(',')"
    >
      <button v-if="open" data-testid="detail-enable-agent-a" @click="$emit('enable-agent', 'agent-a')" />
      <button
        v-if="open && enabledAgentIds?.length"
        data-testid="detail-disable-first-agent"
        @click="$emit('disable-agent', enabledAgentIds[0])"
      />
      <button v-if="open" data-testid="detail-delete" @click="$emit('delete')" />
    </div>
  `
})

const baseSkill = {
  agentId: 'deepchat',
  name: 'review',
  description: 'Review code',
  path: '/skills/review/SKILL.md',
  skillRoot: '/skills/review',
  canonicalPath: '/skills/review',
  sourceType: 'created',
  disabled: false,
  deepchatDisabled: false,
  agentLinks: {},
  mutable: true,
  assigned: true,
  assignedAgentIds: ['agent-a', 'agent-b']
}
const unusedSkill = {
  ...baseSkill,
  name: 'release',
  description: 'Prepare a release',
  assigned: false,
  assignedAgentIds: []
}

const mountSkillsPluginsPage = async () => {
  const SkillsPluginsPage = (
    await import('../../../src/renderer/src/pages/plugins/SkillsPluginsPage.vue')
  ).default
  return mount(SkillsPluginsPage, {
    global: {
      stubs: {
        GuidedOnboardingOverlay: true,
        Separator: true,
        DcButton: ButtonStub,
        DcEmpty: passthrough('DcEmpty'),
        Input: true,
        Switch: true,
        Skeleton: true,
        SkillCard: SkillCardStub,
        SkillImportExportTab: defineComponent({
          name: 'SkillImportExportTab',
          emits: ['busy-change'],
          template:
            '<button data-testid="sync-directory-view" @click="$emit(\'busy-change\', true)" />'
        }),
        ImportSkillsFromAgentDialog: true,
        SkillDetailDialog: SkillDetailDialogStub,
        Icon: true
      }
    }
  })
}

describe('SkillsPluginsPage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    catalogChangedListener = undefined
    mocks.configClient.getSkillDraftSuggestionsEnabled.mockResolvedValue(false)
    mocks.configClient.setSkillDraftSuggestionsEnabled.mockResolvedValue(false)
    mocks.configClient.listAgents.mockResolvedValue([
      { id: 'agent-a', type: 'deepchat', name: 'Agent A', enabled: true },
      { id: 'agent-b', type: 'deepchat', name: 'Agent B', enabled: true },
      { id: 'dimcode', type: 'acp', name: 'DimCode', enabled: true }
    ])
    mocks.skillClient.getAllSkills.mockResolvedValue([baseSkill, unusedSkill])
    mocks.skillClient.onCatalogChanged.mockImplementation((listener: () => void) => {
      catalogChangedListener = listener
      return () => undefined
    })
    mocks.skillClient.readSkillFile.mockResolvedValue('# Review')
    mocks.skillClient.updateSkillFile.mockResolvedValue({ success: true })
    mocks.skillClient.deleteSkill.mockResolvedValue({
      success: true,
      skillName: 'review',
      affectedAgentIds: ['agent-a', 'agent-b']
    })
    mocks.skillClient.setSkillAssigned.mockResolvedValue(undefined)
  })

  it('shows every Skill in one list and opens its preview', async () => {
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()

    expect(wrapper.get('[data-testid="plugin-skill-review"]')).toBeTruthy()
    expect(wrapper.get('[data-testid="plugin-skill-release"]')).toBeTruthy()
    const draftSuggestions = wrapper.get('[data-testid="skills-draft-suggestions"]').element
    for (const selector of [
      '[data-testid="skills-search"]',
      '[data-testid="skills-sync-directory-action"]',
      '[data-testid="skills-import-action"]',
      '[data-testid="skills-grid"]'
    ]) {
      expect(
        draftSuggestions.compareDocumentPosition(wrapper.get(selector).element) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(wrapper.find('[data-testid="skills-agent-assignments-tab"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.skills.assignments')

    await wrapper.get('[data-testid="plugin-skill-review"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.readSkillFile).toHaveBeenCalledWith('review')
    expect(wrapper.get('[data-testid="detail-dialog"]').attributes()).toMatchObject({
      'data-open': 'true',
      'data-name': 'review',
      'data-agent-options': 'agent-a,agent-b',
      'data-enabled-agents': 'agent-a,agent-b',
      'data-enabled-agent-names': 'Agent A,Agent B'
    })
  })

  it('enables and removes Agents from the Skill preview', async () => {
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()
    await wrapper.get('[data-testid="plugin-skill-release"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="detail-enable-agent-a"]').trigger('click')
    await flushPromises()
    expect(mocks.skillClient.setSkillAssigned).toHaveBeenCalledWith('release', true, 'agent-a')
    expect(wrapper.get('[data-testid="detail-dialog"]').attributes('data-enabled-agents')).toBe(
      'agent-a'
    )

    await wrapper.get('[data-testid="detail-disable-first-agent"]').trigger('click')
    await flushPromises()
    expect(mocks.skillClient.setSkillAssigned).toHaveBeenLastCalledWith('release', false, 'agent-a')
    expect(wrapper.get('[data-testid="detail-dialog"]').attributes('data-enabled-agents')).toBe('')
  })

  it('does not let a late Agent mutation replace a newer Skill preview', async () => {
    const assignment = deferred<void>()
    mocks.skillClient.setSkillAssigned.mockReturnValueOnce(assignment.promise)
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()

    await wrapper.get('[data-testid="plugin-skill-release"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="detail-enable-agent-a"]').trigger('click')
    wrapper.findComponent(SkillDetailDialogStub).vm.$emit('update:open', false)
    await flushPromises()
    await wrapper.get('[data-testid="plugin-skill-review"]').trigger('click')
    await flushPromises()

    assignment.resolve()
    await flushPromises()

    expect(wrapper.get('[data-testid="detail-dialog"]').attributes('data-name')).toBe('review')
  })

  it('asks the detail dialog to close when a background refresh removes the open Skill', async () => {
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()
    await wrapper.get('[data-testid="plugin-skill-review"]').trigger('click')
    await flushPromises()
    mocks.skillClient.getAllSkills.mockResolvedValueOnce([unusedSkill])

    catalogChangedListener?.()
    await flushPromises()

    expect(detailRequestClose).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="detail-dialog"]').attributes('data-open')).toBe('true')
  })

  it('keeps sync directory as a secondary view instead of a top-level tab', async () => {
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()

    await wrapper.get('[data-testid="skills-sync-directory-action"]').trigger('click')
    expect(wrapper.get('[data-testid="sync-directory-view"]')).toBeTruthy()
    expect(wrapper.find('[data-testid="skills-grid"]').exists()).toBe(false)

    await wrapper.get('[data-testid="sync-directory-view"]').trigger('click')
    const backAction = wrapper.get('[data-testid="skills-back-action"]')
    expect(backAction.attributes('disabled')).toBeDefined()
    await backAction.trigger('click')
    expect(wrapper.get('[data-testid="sync-directory-view"]')).toBeTruthy()

    wrapper.findComponent({ name: 'SkillImportExportTab' }).vm.$emit('busy-change', false)
    await flushPromises()
    await backAction.trigger('click')
    expect(wrapper.get('[data-testid="skills-grid"]')).toBeTruthy()
  })

  it('revalidates enabled Agent impact when deleting a Skill', async () => {
    const wrapper = await mountSkillsPluginsPage()
    await flushPromises()
    await wrapper.get('[data-testid="plugin-skill-review"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="detail-delete"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.deleteSkill).toHaveBeenCalledWith('review', ['agent-a', 'agent-b'])
  })
})
