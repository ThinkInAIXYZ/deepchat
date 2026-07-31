import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, defineComponent, ref, toRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const createSkill = (name: string, description: string): UnifiedSkillItem => ({
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

  it('keeps picker and mention suggestions on Agent B when Agent A resolves late', async () => {
    const catalogResolvers = new Map<string, (skills: UnifiedSkillItem[]) => void>()
    const skillClient = {
      getUnifiedSkillCatalog: vi.fn(
        (agentId: string) =>
          new Promise<UnifiedSkillItem[]>((resolve) => {
            catalogResolvers.set(agentId, resolve)
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
    vi.doMock('@api/WorkflowClient', () => ({
      createWorkflowClient: () => ({
        listSaved: vi.fn().mockResolvedValue({
          directoryPath: null,
          workflows: []
        })
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
        agentId: { type: String, required: true }
      },
      setup(props) {
        const agentId = toRef(props, 'agentId')
        const conversationId = ref<string | null>(null)
        const skillsData = useSkillsData(conversationId, agentId)
        const mentionItems = ref<Array<{ id: string; label: string; description?: string }>>([])
        const mentions = useChatInputMentions({
          getEditor: () => null,
          workspacePath: ref(null),
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

    const wrapper = mount(Harness, { props: { agentId: 'agent-a' } })
    await flushPromises()
    expect(skillClient.getUnifiedSkillCatalog).toHaveBeenCalledWith('agent-a')

    await wrapper.setProps({ agentId: 'agent-b' })
    await flushPromises()
    expect(skillClient.getUnifiedSkillCatalog).toHaveBeenCalledWith('agent-b')

    catalogResolvers.get('agent-b')?.([
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

    catalogResolvers.get('agent-a')?.([createSkill('shared-skill', 'Agent A description')])
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
  })

  it('keeps saved Workflow slash submissions on the local approval path', async () => {
    const listSaved = vi.fn().mockResolvedValue({
      directoryPath: '/repo/.deepchat/workflows',
      workflows: [
        {
          name: 'review',
          relativePath: '.deepchat/workflows/review.js',
          byteLength: 42,
          updatedAt: 1
        }
      ]
    })
    vi.doMock('@api/WorkflowClient', () => ({
      createWorkflowClient: () => ({ listSaved })
    }))
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => ({
        getActiveSkills: vi.fn().mockResolvedValue([]),
        setActiveSkills: vi.fn().mockResolvedValue([])
      })
    }))
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
    vi.doMock('@/stores/skillsStore', () => ({
      useSkillsStore: () => ({
        getSkillsForAgent: () => [],
        ensureSkillsLoaded: vi.fn().mockResolvedValue(undefined)
      })
    }))

    const { useChatInputMentions } =
      await import('@/components/chat/composables/useChatInputMentions')
    const onCommandSubmit = vi.fn()
    const onWorkflowSubmit = vi.fn()
    const insertedNode = vi.fn()
    const editor = {
      chain: () => {
        const chain = {
          focus: () => chain,
          insertContentAt: (_position: unknown, content: unknown) => {
            if (content && typeof content === 'object') {
              insertedNode(content)
            }
            return chain
          },
          run: () => undefined
        }
        return chain
      }
    }
    const Harness = defineComponent({
      setup() {
        const mentions = useChatInputMentions({
          getEditor: () => null,
          workspacePath: ref('/repo'),
          sessionId: ref('session-1'),
          agentId: ref('deepchat'),
          isAcpSession: ref(true),
          workflowEnabled: ref(true),
          onCommandSubmit,
          onWorkflowSubmit
        })
        const trigger = () => {
          const workflow = mentions.slashSuggestion
            .items({ query: 'review' })
            .find((item) => item.category === 'workflow')
          if (!workflow) {
            return
          }
          mentions.slashSuggestion.command({
            editor: editor as never,
            range: { from: 0, to: 7 },
            props: workflow
          })
          void mentions.submitDialog({ args: '{"target":"src"}' })
        }
        return { trigger }
      },
      template: '<button data-testid="trigger" @click="trigger">trigger</button>'
    })

    const wrapper = mount(Harness)
    await flushPromises()
    await wrapper.get('[data-testid="trigger"]').trigger('click')
    await flushPromises()

    expect(listSaved).toHaveBeenCalledWith('session-1')
    expect(insertedNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commandForm'
      })
    )
    expect(onWorkflowSubmit).toHaveBeenCalledWith('review', '{"target":"src"}')
    expect(onCommandSubmit).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
