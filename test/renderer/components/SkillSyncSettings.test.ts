import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  InstalledSkillAgent,
  InstalledSkillAgentDetail,
  NewDiscovery
} from '@shared/types/skillSync'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const checkboxStub = defineComponent({
  name: 'Checkbox',
  emits: ['update:checked'],
  props: {
    checked: Boolean
  },
  template: '<input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', true)" />'
})

const inputStub = defineComponent({
  name: 'Input',
  emits: ['update:modelValue'],
  props: {
    modelValue: String
  },
  template:
    '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const textareaStub = defineComponent({
  name: 'Textarea',
  emits: ['update:modelValue'],
  props: {
    modelValue: String
  },
  template:
    '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const switchStub = defineComponent({
  name: 'Switch',
  emits: ['update:modelValue'],
  props: {
    modelValue: Boolean
  },
  template:
    '<button data-testid="switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>'
})

const discovery: NewDiscovery = {
  toolId: 'codex',
  toolName: 'Codex',
  newSkills: [
    {
      name: 'write-tests',
      description: 'Write tests',
      path: '/tools/write-tests.md',
      format: 'markdown',
      lastModified: new Date('2024-01-01T00:00:00.000Z')
    }
  ]
}

describe('skill sync settings components', () => {
  async function setupPromptDialog() {
    vi.resetModules()

    let discoveriesListener: ((discoveries: NewDiscovery[]) => void) | null = null
    const unsubscribe = vi.fn()
    const skillSyncClient = {
      onDiscoveriesChanged: vi.fn((listener) => {
        discoveriesListener = listener
        return unsubscribe
      }),
      getNewDiscoveries: vi.fn().mockResolvedValue([discovery]),
      acknowledgeDiscoveries: vi.fn().mockResolvedValue(true)
    }

    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SyncPromptDialog = (
      await import('../../../src/renderer/settings/components/skills/SyncPromptDialog.vue')
    ).default

    const wrapper = mount(SyncPromptDialog, {
      global: {
        stubs: {
          Icon: true,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          Button: buttonStub,
          Checkbox: true
        }
      }
    })
    await flushPromises()

    return {
      wrapper,
      skillSyncClient,
      discoveriesListener: () => discoveriesListener,
      unsubscribe
    }
  }

  it('opens the sync prompt from typed discovery events and unsubscribes', async () => {
    const { wrapper, skillSyncClient, discoveriesListener, unsubscribe } = await setupPromptDialog()
    const listener = discoveriesListener()

    expect(skillSyncClient.onDiscoveriesChanged).toHaveBeenCalledTimes(1)
    listener?.([discovery])

    expect((wrapper.vm as any).isOpen).toBe(true)
    expect(Array.from((wrapper.vm as any).selectedTools)).toEqual(['codex'])
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('checks current discoveries through SkillSyncClient', async () => {
    const { wrapper, skillSyncClient } = await setupPromptDialog()

    await (wrapper.vm as any).checkAndShow()
    await flushPromises()

    expect(skillSyncClient.getNewDiscoveries).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).isOpen).toBe(true)
  })

  it('loads sync status through SkillSyncClient', async () => {
    vi.resetModules()

    const skillSyncClient = {
      scanExternalTools: vi.fn().mockResolvedValue([
        {
          toolId: 'codex',
          toolName: 'Codex',
          available: true,
          skillsDir: '/tools',
          skills: discovery.newSkills
        }
      ])
    }
    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast: vi.fn() })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SyncStatusSection = (
      await import('../../../src/renderer/settings/components/skills/SyncStatusSection.vue')
    ).default

    const wrapper = mount(SyncStatusSection, {
      global: {
        stubs: {
          Icon: true,
          Button: buttonStub,
          SyncStatusCard: true
        }
      }
    })
    await flushPromises()

    expect(skillSyncClient.scanExternalTools).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).tools).toEqual([expect.objectContaining({ toolId: 'codex' })])
  })

  it('renders read-only agent skill rows through SkillSyncClient', async () => {
    vi.resetModules()

    const agent: InstalledSkillAgent = {
      id: 'codex',
      name: 'Codex',
      skillsDir: '/tools',
      isCustom: false,
      supportsLinkManagement: true,
      skillsCount: 1,
      linkedCount: 1,
      agentOwnedCount: 0,
      conflictCount: 0,
      brokenLinkCount: 0,
      status: 'ready'
    }
    const detail: InstalledSkillAgentDetail = {
      ...agent,
      skills: [
        {
          name: 'write-tests',
          description: 'Write tests',
          path: '/tools/write-tests',
          owner: 'deepchat',
          status: 'linked',
          link: {
            isSymlink: true,
            targetPath: '/deepchat/skills/write-tests',
            targetExists: true,
            targetInsideDeepChat: true
          },
          deepchat: { exists: true, path: '/deepchat/skills/write-tests' }
        }
      ]
    }
    const skillSyncClient = {
      scanAgents: vi.fn().mockResolvedValue([agent]),
      getAgentDetail: vi.fn().mockResolvedValue(detail)
    }
    const loadSkills = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast: vi.fn() })
    }))
    vi.doMock('@/stores/skillsStore', () => ({
      useSkillsStore: () => ({ loadSkills })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillAgentsTab = (
      await import('../../../src/renderer/settings/components/skills/SkillAgentsTab.vue')
    ).default

    const wrapper = mount(SkillAgentsTab, {
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Table: passthrough('Table'),
          TableBody: passthrough('TableBody'),
          TableCell: passthrough('TableCell'),
          TableHead: passthrough('TableHead'),
          TableHeader: passthrough('TableHeader'),
          TableRow: passthrough('TableRow'),
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          Label: passthrough('Label'),
          RadioGroup: passthrough('RadioGroup'),
          RadioGroupItem: true
        }
      }
    })
    await flushPromises()

    expect(skillSyncClient.scanAgents).toHaveBeenCalledTimes(1)
    expect(skillSyncClient.getAgentDetail).toHaveBeenCalledWith('codex')
    expect(wrapper.text()).toContain('write-tests')
    expect(wrapper.text()).toContain('settings.skills.agents.status.linked')
  })

  it('previews and executes adoption from agent rows', async () => {
    vi.resetModules()

    const agent: InstalledSkillAgent = {
      id: 'codex',
      name: 'Codex',
      skillsDir: '/tools',
      isCustom: false,
      supportsLinkManagement: true,
      skillsCount: 1,
      linkedCount: 0,
      agentOwnedCount: 1,
      conflictCount: 0,
      brokenLinkCount: 0,
      status: 'ready'
    }
    const beforeDetail: InstalledSkillAgentDetail = {
      ...agent,
      skills: [
        {
          name: 'agent-only',
          description: 'Agent only',
          path: '/tools/agent-only',
          owner: 'agent',
          status: 'agent-owned',
          action: 'adopt',
          deepchat: { exists: false }
        }
      ]
    }
    const afterAgent: InstalledSkillAgent = {
      ...agent,
      linkedCount: 1,
      agentOwnedCount: 0
    }
    const afterDetail: InstalledSkillAgentDetail = {
      ...afterAgent,
      skills: [
        {
          name: 'agent-only',
          description: 'Agent only',
          path: '/tools/agent-only',
          owner: 'deepchat',
          status: 'linked',
          link: {
            isSymlink: true,
            targetPath: '/deepchat/skills/agent-only',
            targetExists: true,
            targetInsideDeepChat: true
          },
          deepchat: { exists: true, path: '/deepchat/skills/agent-only' }
        }
      ]
    }
    const skillSyncClient = {
      scanAgents: vi.fn().mockResolvedValueOnce([agent]).mockResolvedValueOnce([afterAgent]),
      getAgentDetail: vi
        .fn()
        .mockResolvedValueOnce(beforeDetail)
        .mockResolvedValueOnce(afterDetail),
      previewAdoptAgentSkill: vi.fn().mockResolvedValue({
        agentId: 'codex',
        agentName: 'Codex',
        skillName: 'agent-only',
        targetName: 'agent-only',
        sourcePath: '/tools/agent-only',
        agentPath: '/tools/agent-only',
        targetPath: '/deepchat/skills/agent-only',
        backupRoot: '/deepchat/backups/skill-adoptions/codex/agent-only',
        conflict: false,
        warnings: []
      }),
      executeAdoptAgentSkill: vi.fn().mockResolvedValue({
        success: true,
        skillName: 'agent-only',
        targetPath: '/deepchat/skills/agent-only',
        agentPath: '/tools/agent-only'
      })
    }
    const toast = vi.fn()
    const loadSkills = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('@/stores/skillsStore', () => ({
      useSkillsStore: () => ({ loadSkills })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillAgentsTab = (
      await import('../../../src/renderer/settings/components/skills/SkillAgentsTab.vue')
    ).default

    const wrapper = mount(SkillAgentsTab, {
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Table: passthrough('Table'),
          TableBody: passthrough('TableBody'),
          TableCell: passthrough('TableCell'),
          TableHead: passthrough('TableHead'),
          TableHeader: passthrough('TableHeader'),
          TableRow: passthrough('TableRow'),
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          Label: passthrough('Label'),
          RadioGroup: passthrough('RadioGroup'),
          RadioGroupItem: true
        }
      }
    })
    await flushPromises()

    const adoptButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.agents.actions.adopt'))
    expect(adoptButton).toBeTruthy()
    await adoptButton?.trigger('click')
    await flushPromises()

    expect(skillSyncClient.previewAdoptAgentSkill).toHaveBeenCalledWith({
      agentId: 'codex',
      skillName: 'agent-only'
    })
    expect(wrapper.text()).toContain('/deepchat/skills/agent-only')

    const confirmButton = wrapper
      .findAll('button')
      .filter((button) => button.text().includes('settings.skills.agents.actions.adopt'))
      .at(-1)
    expect(confirmButton).toBeTruthy()
    await confirmButton?.trigger('click')
    await flushPromises()

    expect(skillSyncClient.executeAdoptAgentSkill).toHaveBeenCalledWith({
      agentId: 'codex',
      skillName: 'agent-only',
      targetName: 'agent-only'
    })
    expect(skillSyncClient.scanAgents).toHaveBeenCalledTimes(2)
    expect(loadSkills).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.skills.agents.adoptDialog.successTitle' })
    )
  })

  it('previews and installs one library skill to an agent', async () => {
    vi.resetModules()

    const skillSyncClient = {
      scanAgents: vi.fn().mockResolvedValue([
        {
          id: 'codex',
          name: 'Codex',
          skillsDir: '/tools',
          isCustom: false,
          supportsLinkManagement: true,
          skillsCount: 0,
          linkedCount: 0,
          agentOwnedCount: 0,
          conflictCount: 0,
          brokenLinkCount: 0,
          status: 'ready'
        }
      ]),
      previewLinkDeepChatSkills: vi.fn().mockResolvedValue({
        agentId: 'codex',
        agentName: 'Codex',
        skillsDir: '/tools',
        items: [
          {
            skillName: 'write-tests',
            sourcePath: '/deepchat/skills/write-tests',
            targetPath: '/tools/write-tests',
            status: 'ready'
          }
        ]
      }),
      executeLinkDeepChatSkills: vi.fn().mockResolvedValue({
        success: true,
        linked: 1,
        skipped: 0,
        failed: []
      })
    }
    const toast = vi.fn()
    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const InstallSkillToAgentDialog = (
      await import('../../../src/renderer/settings/components/skills/InstallSkillToAgentDialog.vue')
    ).default

    const wrapper = mount(InstallSkillToAgentDialog, {
      props: {
        open: false,
        skill: {
          name: 'write-tests',
          description: 'Write tests',
          path: '/deepchat/skills/write-tests/SKILL.md',
          skillRoot: '/deepchat/skills/write-tests',
          canonicalPath: '/deepchat/skills/write-tests',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle')
        }
      }
    })

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(skillSyncClient.scanAgents).toHaveBeenCalledTimes(1)
    expect(skillSyncClient.previewLinkDeepChatSkills).toHaveBeenCalledWith({
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    expect(wrapper.text()).toContain('/tools/write-tests')

    const applyButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.installToAgent.install'))
    expect(applyButton).toBeTruthy()
    await applyButton?.trigger('click')
    await flushPromises()

    expect(skillSyncClient.executeLinkDeepChatSkills).toHaveBeenCalledWith({
      agentId: 'codex',
      skillNames: ['write-tests']
    })
    expect(wrapper.emitted('completed')).toBeTruthy()
  })

  it('disconnects an already linked skill from the install dialog', async () => {
    vi.resetModules()

    const skillSyncClient = {
      scanAgents: vi.fn().mockResolvedValue([
        {
          id: 'codex',
          name: 'Codex',
          skillsDir: '/tools',
          isCustom: false,
          supportsLinkManagement: true,
          skillsCount: 1,
          linkedCount: 1,
          agentOwnedCount: 0,
          conflictCount: 0,
          brokenLinkCount: 0,
          status: 'ready'
        }
      ]),
      previewLinkDeepChatSkills: vi.fn().mockResolvedValue({
        agentId: 'codex',
        agentName: 'Codex',
        skillsDir: '/tools',
        items: [
          {
            skillName: 'write-tests',
            sourcePath: '/deepchat/skills/write-tests',
            targetPath: '/tools/write-tests',
            status: 'already-linked'
          }
        ]
      }),
      removeAgentSkillLink: vi.fn().mockResolvedValue({
        success: true,
        skillName: 'write-tests',
        agentPath: '/tools/write-tests',
        targetPath: '/deepchat/skills/write-tests'
      })
    }
    const toast = vi.fn()
    vi.doMock('@api/SkillSyncClient', () => ({
      createSkillSyncClient: () => skillSyncClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const InstallSkillToAgentDialog = (
      await import('../../../src/renderer/settings/components/skills/InstallSkillToAgentDialog.vue')
    ).default

    const wrapper = mount(InstallSkillToAgentDialog, {
      props: {
        open: false,
        skill: {
          name: 'write-tests',
          description: 'Write tests',
          path: '/deepchat/skills/write-tests/SKILL.md',
          skillRoot: '/deepchat/skills/write-tests',
          canonicalPath: '/deepchat/skills/write-tests',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle')
        }
      }
    })
    await wrapper.setProps({ open: true })
    await flushPromises()

    const disconnectButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.installToAgent.disconnect'))
    expect(disconnectButton).toBeTruthy()
    await disconnectButton?.trigger('click')
    await flushPromises()

    expect(skillSyncClient.removeAgentSkillLink).toHaveBeenCalledWith({
      agentId: 'codex',
      skillName: 'write-tests'
    })
    expect(wrapper.emitted('completed')).toBeTruthy()
  })

  it('renders skill detail markdown without frontmatter', async () => {
    vi.resetModules()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@/components/markdown/MarkdownRenderer.vue', () => ({
      default: defineComponent({
        name: 'MarkdownRenderer',
        props: { content: String },
        template: '<article>{{ content }}</article>'
      })
    }))

    const SkillDetailDialog = (
      await import('../../../src/renderer/settings/components/skills/SkillDetailDialog.vue')
    ).default

    const wrapper = mount(SkillDetailDialog, {
      props: {
        open: true,
        name: 'write-tests',
        description: 'Write tests',
        sourcePath: '/skills/write-tests/SKILL.md',
        markdown: '---\nname: write-tests\ndescription: Write tests\n---\n# Write tests'
      },
      global: {
        stubs: {
          Icon: true,
          Button: buttonStub,
          Input: inputStub,
          Label: passthrough('Label'),
          Switch: switchStub,
          Textarea: textareaStub,
          AlertDialog: passthrough('AlertDialog'),
          AlertDialogAction: buttonStub,
          AlertDialogCancel: buttonStub,
          AlertDialogContent: passthrough('AlertDialogContent'),
          AlertDialogDescription: passthrough('AlertDialogDescription'),
          AlertDialogFooter: passthrough('AlertDialogFooter'),
          AlertDialogHeader: passthrough('AlertDialogHeader'),
          AlertDialogTitle: passthrough('AlertDialogTitle'),
          AlertDialogTrigger: passthrough('AlertDialogTrigger'),
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle')
        }
      }
    })

    expect(wrapper.text()).toContain('# Write tests')
    expect(wrapper.text()).not.toContain('description: Write tests')
  })

  it('edits skill markdown from the detail dialog', async () => {
    vi.resetModules()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))
    vi.doMock('@/components/markdown/MarkdownRenderer.vue', () => ({
      default: defineComponent({
        name: 'MarkdownRenderer',
        props: { content: String },
        template: '<article>{{ content }}</article>'
      })
    }))

    const SkillDetailDialog = (
      await import('../../../src/renderer/settings/components/skills/SkillDetailDialog.vue')
    ).default

    const wrapper = mount(SkillDetailDialog, {
      props: {
        open: true,
        name: 'write-tests',
        description: 'Write tests',
        sourcePath: '/skills/write-tests/SKILL.md',
        markdown:
          '---\nname: write-tests\ndescription: Write tests\nallowedTools:\n  - Read\n---\n# Write tests',
        mutable: true,
        canInstallToAgent: true
      },
      global: {
        stubs: {
          Icon: true,
          Button: buttonStub,
          Input: inputStub,
          Label: passthrough('Label'),
          Switch: switchStub,
          Textarea: textareaStub,
          AlertDialog: passthrough('AlertDialog'),
          AlertDialogAction: buttonStub,
          AlertDialogCancel: buttonStub,
          AlertDialogContent: passthrough('AlertDialogContent'),
          AlertDialogDescription: passthrough('AlertDialogDescription'),
          AlertDialogFooter: passthrough('AlertDialogFooter'),
          AlertDialogHeader: passthrough('AlertDialogHeader'),
          AlertDialogTitle: passthrough('AlertDialogTitle'),
          AlertDialogTrigger: passthrough('AlertDialogTrigger'),
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle')
        }
      }
    })

    const editButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.detail.edit'))
    expect(editButton).toBeTruthy()
    await editButton?.trigger('click')

    const textareas = wrapper.findAll('textarea')
    await textareas[0].setValue('Updated description')
    await textareas[1].setValue('# Updated instructions')

    const toolsInput = wrapper.findAll('input')[1]
    await toolsInput.setValue('Read, Bash')

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    expect(saveButton).toBeTruthy()
    await saveButton?.trigger('click')

    const savedContent = wrapper.emitted('save')?.[0]?.[0] as string
    expect(savedContent).toContain('description: \"Updated description\"')
    expect(savedContent).toContain('- \"Read\"')
    expect(savedContent).toContain('- \"Bash\"')
    expect(savedContent).toContain('# Updated instructions')
  })

  it('opens detail from the skill card body without routing exposed controls through detail', async () => {
    vi.resetModules()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillCard = (
      await import('../../../src/renderer/settings/components/skills/SkillCard.vue')
    ).default

    const wrapper = mount(SkillCard, {
      props: {
        skill: {
          name: 'write-tests',
          description: 'Write tests',
          path: '/skills/write-tests/SKILL.md',
          skillRoot: '/skills/write-tests',
          canonicalPath: '/skills/write-tests/SKILL.md',
          sourceType: 'created',
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      },
      global: {
        stubs: {
          Icon: true,
          Button: buttonStub,
          Badge: passthrough('Badge'),
          Switch: switchStub
        }
      }
    })

    await wrapper.trigger('click')
    expect(wrapper.emitted('view')).toHaveLength(1)

    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('install-to-agent')).toHaveLength(1)
    expect(wrapper.emitted('view')).toHaveLength(1)

    await wrapper.get('[data-testid=\"switch\"]').trigger('click')
    expect(wrapper.emitted('toggle-disabled')?.[0]).toEqual([true])
    expect(wrapper.emitted('view')).toHaveLength(1)
  })

  it('scans and installs a root SKILL.md Git repository from the Git dialog', async () => {
    vi.resetModules()

    const skillClient = {
      scanGitSkillRepo: vi.fn().mockResolvedValue({
        repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
        repoFormat: 'single-skill',
        skills: [
          {
            name: 'guizang-ppt-skill',
            description: 'Create PPT files',
            relativePath: 'SKILL.md',
            conflict: false,
            valid: true
          }
        ]
      }),
      installFromGit: vi.fn().mockResolvedValue([{ success: true, skillName: 'guizang-ppt-skill' }])
    }
    const toast = vi.fn()
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const InstallFromGitDialog = (
      await import('../../../src/renderer/settings/components/skills/InstallFromGitDialog.vue')
    ).default

    const wrapper = mount(InstallFromGitDialog, {
      props: { open: true },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          Input: inputStub,
          RadioGroup: passthrough('RadioGroup'),
          RadioGroupItem: true
        }
      }
    })

    const scanButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.git.scan'))
    await scanButton?.trigger('click')
    await flushPromises()

    expect(skillClient.scanGitSkillRepo).toHaveBeenCalledWith(
      'https://github.com/op7418/guizang-ppt-skill'
    )
    expect(wrapper.text()).toContain('guizang-ppt-skill')

    const installButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.git.install'))
    await installButton?.trigger('click')
    await flushPromises()

    expect(skillClient.installFromGit).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/op7418/guizang-ppt-skill',
      skillNames: ['guizang-ppt-skill'],
      strategy: 'rename'
    })
    expect(wrapper.emitted('installed')).toBeTruthy()
  })

  it('previews and executes manual sync directory export and import', async () => {
    vi.resetModules()

    const skillClient = {
      getSkillsSyncConfig: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        layout: 'multi-skill-repo',
        lastExportAt: null,
        lastImportAt: null
      }),
      previewSyncDirectoryExport: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        items: [
          {
            name: 'guizang-ppt-skill',
            state: 'new',
            sourcePath: '/deepchat/skills/guizang-ppt-skill',
            targetPath: '/sync/skills/guizang-ppt-skill'
          }
        ]
      }),
      executeSyncDirectoryExport: vi.fn().mockResolvedValue({
        success: true,
        exported: 1,
        skipped: 0,
        failed: []
      }),
      previewSyncDirectoryImport: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        items: [
          {
            name: 'guizang-ppt-skill',
            state: 'new',
            sourcePath: '/sync/skills/guizang-ppt-skill',
            targetPath: '/deepchat/skills/guizang-ppt-skill'
          }
        ]
      }),
      executeSyncDirectoryImport: vi.fn().mockResolvedValue({
        success: true,
        imported: 1,
        skipped: 0,
        failed: []
      })
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => ({
        selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
      })
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast: vi.fn() })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillImportExportTab = (
      await import('../../../src/renderer/settings/components/skills/SkillImportExportTab.vue')
    ).default

    const wrapper = mount(SkillImportExportTab, {
      props: {
        skills: [
          {
            name: 'guizang-ppt-skill',
            description: 'Create PPT files',
            path: '/deepchat/skills/guizang-ppt-skill/SKILL.md',
            skillRoot: '/deepchat/skills/guizang-ppt-skill',
            canonicalPath: '/deepchat/skills/guizang-ppt-skill',
            sourceType: 'created',
            deepchatDisabled: false,
            agentLinks: {},
            mutable: true
          }
        ]
      },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Checkbox: checkboxStub,
          Input: inputStub,
          RadioGroup: passthrough('RadioGroup'),
          RadioGroupItem: true,
          Tabs: passthrough('Tabs'),
          TabsContent: passthrough('TabsContent'),
          TabsList: passthrough('TabsList'),
          TabsTrigger: passthrough('TabsTrigger')
        }
      }
    })
    await flushPromises()

    const previewExportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.importExport.previewExport'))
    await previewExportButton?.trigger('click')
    await flushPromises()
    expect(skillClient.previewSyncDirectoryExport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill'],
      includeDisabled: false
    })

    const exportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.importExport.exportNow'))
    await exportButton?.trigger('click')
    await flushPromises()
    expect(skillClient.executeSyncDirectoryExport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill'],
      includeDisabled: false
    })

    const previewImportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.importExport.previewImport'))
    await previewImportButton?.trigger('click')
    await flushPromises()
    expect(skillClient.previewSyncDirectoryImport).toHaveBeenCalledTimes(1)

    const importButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.importExport.importSelected'))
    await importButton?.trigger('click')
    await flushPromises()
    expect(skillClient.executeSyncDirectoryImport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill'],
      strategy: 'rename'
    })
    expect(wrapper.emitted('completed')).toBeTruthy()
  })
})
