import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { onBeforeRouteLeave } from 'vue-router'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: vi.fn()
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  props: {
    disabled: Boolean
  },
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
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

const dropdownActionStub = defineComponent({
  name: 'DcDropdownActionItem',
  props: { label: String },
  emits: ['select'],
  template: '<button type="button" @click="$emit(\'select\')">{{ label }}</button>'
})

describe('skill sync settings components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      await import('../../../src/renderer/src/pages/plugins/skills/SkillDetailDialog.vue')
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
          DcButton: buttonStub,
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
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          DcDropdownActionItem: dropdownActionStub
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
      await import('../../../src/renderer/src/pages/plugins/skills/SkillDetailDialog.vue')
    ).default

    const wrapper = mount(SkillDetailDialog, {
      props: {
        open: true,
        name: 'write-tests',
        description: 'Write tests',
        sourcePath: '/skills/write-tests/SKILL.md',
        markdown:
          '---\nname: write-tests\ndescription: Write tests\nallowedTools:\n  - Read\nplatforms:\n  - darwin\nmetadata:\n  category: qa\n---\n# Write tests',
        mutable: true
      },
      global: {
        stubs: {
          Icon: true,
          DcButton: buttonStub,
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
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          DcDropdownActionItem: dropdownActionStub
        }
      }
    })

    const actionButtons = wrapper
      .get('[data-testid="skill-detail-actions"]')
      .findAll('button')
      .map((button) => button.text())
    const editIndex = actionButtons.findIndex((text) =>
      text.includes('settings.skills.detail.edit')
    )
    const deleteIndex = actionButtons.findIndex((text) =>
      text.includes('settings.skills.detail.delete')
    )
    expect(editIndex).toBeGreaterThanOrEqual(0)
    expect(deleteIndex).toBeGreaterThan(editIndex)

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

    const routeGuard = vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)?.[0] as () => unknown
    const leaveResult = routeGuard()
    expect(leaveResult).toBeInstanceOf(Promise)
    await flushPromises()
    const stayButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.leaveGuard.stay'))
    await stayButton?.trigger('click')
    await expect(leaveResult).resolves.toBe(false)

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('common.save'))
    expect(saveButton).toBeTruthy()
    await saveButton?.trigger('click')

    const savedContent = wrapper.emitted('save')?.[0]?.[0] as string
    expect(savedContent).toContain('description: \"Updated description\"')
    expect(savedContent).toContain('- \"Read\"')
    expect(savedContent).toContain('- \"Bash\"')
    expect(savedContent).toContain('- \"darwin\"')
    expect(savedContent).toContain('category: \"qa\"')
    expect(savedContent).toContain('# Updated instructions')

    await textareas[0].setValue('   ')
    expect(saveButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('components.promptParamsDialog.required')

    wrapper.findComponent({ name: 'Dialog' }).vm.$emit('update:open', false)
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.text()).toContain('settings.leaveGuard.dirtyTitle')

    const discardButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.leaveGuard.discard'))
    await discardButton?.trigger('click')
    expect((wrapper.vm as any).discardConfirmOpen).toBe(false)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])

    await editButton?.trigger('click')
    await wrapper.findAll('textarea')[0].setValue('Discard before route change')
    const confirmedLeave = routeGuard()
    await flushPromises()
    await discardButton?.trigger('click')
    await expect(confirmedLeave).resolves.toBe(true)
    expect((wrapper.vm as any).discardConfirmOpen).toBe(false)
  })

  it('opens a Skill preview from the whole card', async () => {
    vi.resetModules()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillCard = (await import('../../../src/renderer/src/pages/plugins/skills/SkillCard.vue'))
      .default

    const wrapper = mount(SkillCard, {
      props: {
        skill: {
          name: 'write-tests',
          description: 'Write tests',
          path: '/skills/write-tests/SKILL.md',
          skillRoot: '/skills/write-tests',
          canonicalPath: '/skills/write-tests/SKILL.md',
          sourceType: 'created',
          agentId: 'deepchat',
          assigned: true,
          assignedAgentIds: ['deepchat'],
          disabled: false,
          deepchatDisabled: false,
          agentLinks: {},
          mutable: true
        }
      },
      global: {
        stubs: {}
      }
    })

    await wrapper.get('[data-testid="plugin-skill-write-tests"]').trigger('click')
    expect(wrapper.emitted('view')).toHaveLength(1)
    expect(wrapper.text()).toBe('write-testsWrite tests')
  })

  it('manages enabled Agents inside the Skill preview', async () => {
    vi.resetModules()

    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
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
      await import('../../../src/renderer/src/pages/plugins/skills/SkillDetailDialog.vue')
    ).default
    const wrapper = mount(SkillDetailDialog, {
      props: {
        open: true,
        name: 'write-tests',
        description: 'Write tests',
        markdown: '# Write tests',
        agents: [
          { id: 'writer', name: 'Writer' },
          { id: 'reviewer', name: 'Reviewer' }
        ],
        enabledAgentIds: ['writer'],
        enabledAgentNames: ['Writer']
      },
      global: {
        stubs: {
          Icon: true,
          DcButton: buttonStub,
          Input: inputStub,
          Label: passthrough('Label'),
          Switch: switchStub,
          Textarea: textareaStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
          DropdownMenu: passthrough('DropdownMenu'),
          DropdownMenuContent: passthrough('DropdownMenuContent'),
          DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
          DcDropdownActionItem: dropdownActionStub
        }
      }
    })

    expect(wrapper.get('[data-testid="skill-detail-enabled-agent-writer"]').text()).toContain(
      'Writer'
    )
    await wrapper.get('[data-testid="skill-detail-enabled-agent-writer"] button').trigger('click')
    expect(wrapper.emitted('disable-agent')).toEqual([['writer']])

    await wrapper.findComponent({ name: 'DcDropdownActionItem' }).trigger('click')
    expect(wrapper.emitted('enable-agent')).toEqual([['reviewer']])
  })

  it('exports selected sync directory skills and refreshes imports on tab switch', async () => {
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
        exported: 2,
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
          },
          {
            name: 'same-skill',
            state: 'same',
            sourcePath: '/sync/skills/same-skill',
            targetPath: '/deepchat/skills/same-skill'
          },
          {
            name: 'broken-skill',
            state: 'invalid',
            sourcePath: '/sync/skills/broken-skill',
            targetPath: '/deepchat/skills/broken-skill',
            error: 'missing SKILL.md'
          },
          {
            name: 'conflict-skill',
            state: 'conflict',
            sourcePath: '/sync/skills/conflict-skill',
            targetPath: '/deepchat/skills/conflict-skill'
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
    const projectClient = {
      pathExists: vi.fn().mockResolvedValue(true)
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@api/ProjectClient', () => ({
      createProjectClient: () => projectClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => ({
        selectDirectory: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
      })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          params?.count === undefined ? key : `${key}:${params.count}`
      })
    }))

    const SkillImportExportTab = (
      await import('../../../src/renderer/src/pages/plugins/skills/SkillImportExportTab.vue')
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
          },
          {
            name: 'disabled-skill',
            description: 'Disabled skill',
            path: '/deepchat/skills/disabled-skill/SKILL.md',
            skillRoot: '/deepchat/skills/disabled-skill',
            canonicalPath: '/deepchat/skills/disabled-skill',
            sourceType: 'created',
            deepchatDisabled: true,
            agentLinks: {},
            mutable: true
          }
        ]
      },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          DcButton: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
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

    expect(projectClient.pathExists).toHaveBeenCalledWith('/sync')
    expect((wrapper.vm as any).syncDirectoryReady).toBe(true)
    expect(Array.from((wrapper.vm as any).selectedExportNames)).toEqual([])
    expect(wrapper.text()).toContain('disabled-skill')
    expect(wrapper.findAll('.overflow-y-auto').length).toBeGreaterThanOrEqual(2)

    ;(wrapper.vm as any).exportQuery = 'disabled'
    await flushPromises()
    ;(wrapper.vm as any).selectVisibleExport()
    expect(Array.from((wrapper.vm as any).selectedExportNames)).toEqual(['disabled-skill'])

    ;(wrapper.vm as any).clearExportSelection()
    ;(wrapper.vm as any).exportQuery = ''
    await flushPromises()
    ;(wrapper.vm as any).selectVisibleExport()
    expect(Array.from((wrapper.vm as any).selectedExportNames).sort()).toEqual([
      'disabled-skill',
      'guizang-ppt-skill'
    ])

    expect((wrapper.vm as any).canExport).toBe(true)
    await (wrapper.vm as any).requestExportConfirmation()
    await flushPromises()
    expect(skillClient.previewSyncDirectoryExport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill', 'disabled-skill'],
      includeDisabled: true
    })
    expect((wrapper.vm as any).exportConfirmOpen).toBe(true)
    expect(skillClient.executeSyncDirectoryExport).not.toHaveBeenCalled()

    ;(wrapper.vm as any).exportConfirmOpen = false
    await flushPromises()
    expect(skillClient.executeSyncDirectoryExport).not.toHaveBeenCalled()

    ;(wrapper.vm as any).exportConfirmOpen = true
    await (wrapper.vm as any).executeExport()
    await flushPromises()
    expect(skillClient.executeSyncDirectoryExport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill', 'disabled-skill'],
      includeDisabled: true
    })
    expect((wrapper.vm as any).exportConfirmOpen).toBe(false)

    skillClient.executeSyncDirectoryExport.mockResolvedValueOnce({
      success: false,
      exported: 1,
      skipped: 0,
      failed: [{ skillName: 'disabled-skill', reason: '/private/sync is read-only' }]
    })
    ;(wrapper.vm as any).exportConfirmOpen = true
    await (wrapper.vm as any).executeExport()
    await flushPromises()
    expect((wrapper.vm as any).exportConfirmOpen).toBe(true)
    // 部分失败走按钮 ⚠ + 内联错误，不再弹 toast
    expect(notifyRenderer).not.toHaveBeenCalled()
    expect((wrapper.vm as any).exportStatus).toBe('error')
    expect(wrapper.text()).toContain('settings.skills.importExport.result')
    expect((wrapper.vm as any).retryExportNames).toEqual(['disabled-skill'])
    expect(wrapper.text()).not.toContain('/private/sync')

    ;(wrapper.vm as any).activeTab = 'import'
    await flushPromises()
    expect(skillClient.previewSyncDirectoryImport).toHaveBeenCalledTimes(1)
    expect(Array.from((wrapper.vm as any).selectedImportNames)).toEqual([])

    ;(wrapper.vm as any).activeTab = 'export'
    await flushPromises()
    ;(wrapper.vm as any).activeTab = 'import'
    await flushPromises()
    expect(skillClient.previewSyncDirectoryImport).toHaveBeenCalledTimes(1)

    const refreshImportButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.skills.importExport.refresh'))
    await refreshImportButton?.trigger('click')
    await flushPromises()
    expect(skillClient.previewSyncDirectoryImport).toHaveBeenCalledTimes(2)

    ;(wrapper.vm as any).selectVisibleImport()
    expect(Array.from((wrapper.vm as any).selectedImportNames).sort()).toEqual([
      'conflict-skill',
      'guizang-ppt-skill'
    ])

    expect((wrapper.vm as any).canImport).toBe(true)
    await (wrapper.vm as any).executeImport()
    await flushPromises()
    expect(skillClient.executeSyncDirectoryImport).toHaveBeenCalledWith({
      skillNames: ['guizang-ppt-skill', 'conflict-skill'],
      strategy: 'overwrite'
    })

    skillClient.executeSyncDirectoryImport.mockResolvedValueOnce({
      success: false,
      imported: 1,
      skipped: 0,
      failed: [{ skillName: 'conflict-skill', reason: '/private/import failed' }]
    })
    ;(wrapper.vm as any).selectVisibleImport()
    await (wrapper.vm as any).executeImport()
    await flushPromises()
    expect(Array.from((wrapper.vm as any).selectedImportNames)).toEqual(['conflict-skill'])
    expect(wrapper.text()).not.toContain('/private/import')
  })

  it('blocks overlapping sync directory picker flows', async () => {
    vi.resetModules()

    const skillClient = {
      getSkillsSyncConfig: vi.fn().mockResolvedValue(null),
      setSkillsSyncDirectory: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        layout: 'multi-skill-repo',
        lastExportAt: null,
        lastImportAt: null
      }),
      previewSyncDirectoryExport: vi.fn(),
      executeSyncDirectoryExport: vi.fn(),
      previewSyncDirectoryImport: vi.fn(),
      executeSyncDirectoryImport: vi.fn()
    }
    let resolveSelect: (value: { canceled: boolean; filePaths: string[] }) => void = () => {}
    const deviceClient = {
      selectDirectory: vi.fn(
        () =>
          new Promise<{ canceled: boolean; filePaths: string[] }>((resolve) => {
            resolveSelect = resolve
          })
      )
    }
    const projectClient = {
      pathExists: vi.fn().mockResolvedValue(true)
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => deviceClient
    }))
    vi.doMock('@api/ProjectClient', () => ({
      createProjectClient: () => projectClient
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SkillImportExportTab = (
      await import('../../../src/renderer/src/pages/plugins/skills/SkillImportExportTab.vue')
    ).default

    const wrapper = mount(SkillImportExportTab, {
      props: { skills: [] },
      global: {
        stubs: {
          Icon: true,
          Badge: passthrough('Badge'),
          DcButton: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
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

    const routeGuard = vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)?.[0] as () => unknown
    expect(routeGuard()).toBe(true)
    ;(wrapper.vm as any).operationPending = true
    expect(routeGuard()).toBe(false)
    ;(wrapper.vm as any).operationPending = false

    const firstChoose = (wrapper.vm as any).chooseDirectory()
    const secondChoose = (wrapper.vm as any).chooseDirectory()
    expect(deviceClient.selectDirectory).toHaveBeenCalledTimes(1)

    resolveSelect({ canceled: false, filePaths: ['/sync'] })
    await firstChoose
    await secondChoose
    await flushPromises()

    expect(skillClient.setSkillsSyncDirectory).toHaveBeenCalledTimes(1)
    expect(skillClient.setSkillsSyncDirectory).toHaveBeenCalledWith('/sync')
  })

  it('keeps sync directory preview failures in the active surface', async () => {
    vi.resetModules()

    const skillClient = {
      getSkillsSyncConfig: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        layout: 'multi-skill-repo',
        lastExportAt: null,
        lastImportAt: null
      }),
      previewSyncDirectoryExport: vi.fn().mockRejectedValue(new Error('export preview failed')),
      executeSyncDirectoryExport: vi.fn(),
      previewSyncDirectoryImport: vi.fn().mockRejectedValue(new Error('import preview failed')),
      executeSyncDirectoryImport: vi.fn()
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => ({
        selectDirectory: vi.fn()
      })
    }))
    vi.doMock('@api/ProjectClient', () => ({
      createProjectClient: () => ({
        pathExists: vi.fn().mockResolvedValue(true)
      })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SkillImportExportTab = (
      await import('../../../src/renderer/src/pages/plugins/skills/SkillImportExportTab.vue')
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
          DcButton: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
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

    ;(wrapper.vm as any).selectedExportNames = new Set(['guizang-ppt-skill'])
    await (wrapper.vm as any).requestExportConfirmation()
    await flushPromises()

    expect((wrapper.vm as any).exportConfirmOpen).toBe(false)
    expect((wrapper.vm as any).previewing).toBe(false)
    expect((wrapper.vm as any).previewError).toBe(true)
    expect(wrapper.text()).toContain('settings.skills.sync.previewError')
    expect(wrapper.text()).not.toContain('export preview failed')

    await (wrapper.vm as any).previewImport()
    await flushPromises()

    expect((wrapper.vm as any).importPreview).toBeNull()
    expect((wrapper.vm as any).previewing).toBe(false)
    expect((wrapper.vm as any).previewError).toBe(true)
    expect(wrapper.text()).not.toContain('import preview failed')
  })

  it('hides sync directory operations until a valid directory is selected', async () => {
    vi.resetModules()

    const skillClient = {
      getSkillsSyncConfig: vi.fn().mockResolvedValue({
        skillsDirectory: '/missing-sync',
        layout: 'multi-skill-repo',
        lastExportAt: null,
        lastImportAt: null
      }),
      setSkillsSyncDirectory: vi.fn().mockResolvedValue({
        skillsDirectory: '/sync',
        layout: 'multi-skill-repo',
        lastExportAt: null,
        lastImportAt: null
      }),
      previewSyncDirectoryExport: vi.fn(),
      executeSyncDirectoryExport: vi.fn(),
      previewSyncDirectoryImport: vi.fn(),
      executeSyncDirectoryImport: vi.fn()
    }
    const deviceClient = {
      selectDirectory: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/sync'] })
    }
    const projectClient = {
      pathExists: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@api/DeviceClient', () => ({
      createDeviceClient: () => deviceClient
    }))
    vi.doMock('@api/ProjectClient', () => ({
      createProjectClient: () => projectClient
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SkillImportExportTab = (
      await import('../../../src/renderer/src/pages/plugins/skills/SkillImportExportTab.vue')
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
          DcButton: buttonStub,
          Checkbox: checkboxStub,
          Dialog: passthrough('Dialog'),
          DialogContent: passthrough('DialogContent'),
          DialogDescription: passthrough('DialogDescription'),
          DialogFooter: passthrough('DialogFooter'),
          DialogHeader: passthrough('DialogHeader'),
          DialogTitle: passthrough('DialogTitle'),
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

    expect(wrapper.text()).toContain('settings.skills.importExport.directoryMissingAction')
    expect(wrapper.text()).not.toContain('guizang-ppt-skill')
    expect((wrapper.vm as any).syncDirectoryReady).toBe(false)

    await (wrapper.vm as any).chooseDirectory()
    await flushPromises()

    expect(deviceClient.selectDirectory).toHaveBeenCalledTimes(1)
    expect(skillClient.setSkillsSyncDirectory).toHaveBeenCalledWith('/sync')
    expect((wrapper.vm as any).syncDirectoryReady).toBe(true)
    expect(wrapper.text()).toContain('guizang-ppt-skill')
  })
})
