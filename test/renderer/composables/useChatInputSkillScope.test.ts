import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, defineComponent, ref, toRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const createSkill = (name: string, description: string): UnifiedSkillItem => ({
  agentId: 'deepchat',
  assigned: true,
  assignedAgentIds: [],
  disabled: false,
  name,
  description,
  path: `/skills/${name}/SKILL.md`,
  skillRoot: `/skills/${name}`,
  canonicalPath: `/skills/${name}/SKILL.md`,
  sourceType: 'created',
  deepchatDisabled: false,
  agentLinks: {},
  mutable: true
})

describe('chat input Skill Agent scope', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it.each(['agent', 'workspace'])(
    'keeps picker and suggestions in the latest %s scope',
    async (scope) => {
      const catalogResolvers = new Map<string, (skills: UnifiedSkillItem[]) => void>()
      const skillClient = {
        getUnifiedSkillCatalog: vi.fn(
          (agentId: string, workspacePath?: string) =>
            new Promise<UnifiedSkillItem[]>((resolve) => {
              catalogResolvers.set(workspacePath ?? agentId, resolve)
            })
        ),
        getActiveSkills: vi.fn().mockResolvedValue([]),
        setActiveSkills: vi.fn().mockResolvedValue([]),
        onCatalogChanged: vi.fn(() => () => undefined),
        onSessionChanged: vi.fn(() => () => undefined)
      }
      vi.doMock('@api/SkillClient', () => ({ createSkillClient: () => skillClient }))
      vi.doMock('@api/SessionClient', () => ({
        createSessionClient: () => ({
          getAcpSessionCommands: vi.fn().mockResolvedValue([]),
          onAcpCommandsReady: vi.fn(() => () => undefined)
        })
      }))
      vi.doMock('@api/WorkspaceClient', () => ({
        createWorkspaceClient: () => ({
          registerWorkspace: vi.fn().mockResolvedValue(undefined),
          searchFiles: vi.fn().mockResolvedValue([])
        })
      }))
      vi.doMock('@/stores/mcp', () => ({
        useMcpStore: () => ({
          visiblePrompts: [],
          visibleTools: [],
          pluginTools: [],
          loadPrompts: vi.fn().mockResolvedValue(undefined),
          loadTools: vi.fn().mockResolvedValue(undefined),
          getPrompt: vi.fn()
        })
      }))

      const [{ useSkillsData }, { useChatInputMentions }] = await Promise.all([
        import('@/components/chat-input/composables/useSkillsData'),
        import('@/components/chat/composables/useChatInputMentions')
      ])
      const Harness = defineComponent({
        props: {
          agentId: { type: String, required: true },
          workspacePath: { type: String, default: null }
        },
        setup(props) {
          const agentId = toRef(props, 'agentId')
          const conversationId = ref<string | null>(null)
          const workspacePath = toRef(props, 'workspacePath')
          const skillsData = useSkillsData(conversationId, agentId, workspacePath)
          const mentionItems = ref<Array<{ id: string; label: string; description?: string }>>([])
          const mentions = useChatInputMentions({
            getEditor: () => null,
            workspacePath,
            skills: skillsData.skills,
            sessionId: conversationId,
            agentId,
            isAcpSession: ref(false),
            onCommandSubmit: vi.fn(),
            onActivateSkill: skillsData.activateSkill
          })
          const refreshMentions = () => {
            mentionItems.value = mentions.slashSuggestion.items({ query: '' })
          }

          return {
            pickerSkills: computed(() => skillsData.skills.value),
            pendingSkills: skillsData.pendingSkills,
            activateSkill: skillsData.activateSkill,
            mentionItems,
            refreshMentions
          }
        },
        template: `
        <div>
          <button data-testid="refresh-mentions" @click="refreshMentions">refresh</button>
          <div
            v-for="skill in pickerSkills"
            :key="skill.name"
            :data-testid="\`picker-\${skill.name}\`"
          >{{ skill.name }}|{{ skill.description }}</div>
          <div
            v-for="item in mentionItems"
            :key="item.id"
            :data-testid="\`mention-\${item.id}\`"
          >{{ item.label }}|{{ item.description }}</div>
        </div>
      `
      })

      const initialProps =
        scope === 'agent'
          ? { agentId: 'agent-a' }
          : { agentId: 'writer', workspacePath: '/project-a' }
      const nextProps =
        scope === 'agent'
          ? { agentId: 'agent-b' }
          : { agentId: 'writer', workspacePath: '/project-b' }
      const initialKey = scope === 'agent' ? 'agent-a' : '/project-a'
      const nextKey = scope === 'agent' ? 'agent-b' : '/project-b'
      const wrapper = mount(Harness, { props: initialProps })
      await flushPromises()
      expect(catalogResolvers.has(initialKey)).toBe(true)
      await wrapper.vm.activateSkill('shared-skill')

      await wrapper.setProps(nextProps)
      await flushPromises()
      expect(catalogResolvers.has(nextKey)).toBe(true)
      expect(wrapper.vm.pendingSkills).toEqual([])

      catalogResolvers.get(nextKey)?.([
        createSkill('shared-skill', 'Agent B description'),
        createSkill('b-only-skill', 'Only Agent B')
      ])
      await flushPromises()
      await wrapper.get('[data-testid="refresh-mentions"]').trigger('click')

      expect(wrapper.get('[data-testid="picker-shared-skill"]').text()).toBe(
        'shared-skill|Agent B description'
      )
      expect(wrapper.get('[data-testid="picker-b-only-skill"]').text()).toBe(
        'b-only-skill|Only Agent B'
      )
      expect(wrapper.get('[data-testid="mention-skill:shared-skill"]').text()).toBe(
        'shared-skill|Agent B description'
      )
      expect(wrapper.get('[data-testid="mention-skill:b-only-skill"]').text()).toBe(
        'b-only-skill|Only Agent B'
      )

      catalogResolvers.get(initialKey)?.([createSkill('shared-skill', 'Agent A description')])
      await flushPromises()
      await wrapper.get('[data-testid="refresh-mentions"]').trigger('click')

      expect(wrapper.get('[data-testid="picker-shared-skill"]').text()).toBe(
        'shared-skill|Agent B description'
      )
      expect(wrapper.get('[data-testid="mention-skill:shared-skill"]').text()).toBe(
        'shared-skill|Agent B description'
      )
      expect(wrapper.find('[data-testid="picker-b-only-skill"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="mention-skill:b-only-skill"]').exists()).toBe(true)
      if (scope === 'workspace') {
        window.dispatchEvent(new Event('focus'))
        await flushPromises()
        catalogResolvers.get(nextKey)?.([])
        await flushPromises()
        await wrapper.get('[data-testid="refresh-mentions"]').trigger('click')
        expect(wrapper.find('[data-testid="picker-b-only-skill"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="mention-skill:b-only-skill"]').exists()).toBe(false)
      }
      wrapper.unmount()
    }
  )
})
