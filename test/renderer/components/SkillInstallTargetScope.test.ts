import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import InstallFromGitDialog from '../../../src/renderer/settings/components/skills/InstallFromGitDialog.vue'
import SkillInstallDialog from '../../../src/renderer/settings/components/skills/SkillInstallDialog.vue'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const mocks = vi.hoisted(() => ({
  notifyRenderer: vi.fn(),
  skillClient: {
    onCatalogChanged: vi.fn(() => () => undefined),
    scanGitSkillRepo: vi.fn(),
    installFromGit: vi.fn(),
    installFromFolder: vi.fn(),
    installFromZip: vi.fn(),
    installFromUrl: vi.fn()
  },
  deviceClient: {
    selectDirectory: vi.fn(),
    selectFiles: vi.fn()
  }
}))

vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
}))

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: mocks.notifyRenderer
}))

vi.mock('@api/DeviceClient', () => ({
  createDeviceClient: () => mocks.deviceClient
}))

vi.mock('@api/FileClient', () => ({
  createFileClient: () => ({ getPathForFile: vi.fn() })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: { disabled: Boolean },
  template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'Input',
  props: { modelValue: String, disabled: Boolean },
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" :disabled="disabled" />'
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const globalOptions = (realAlertDialog = false) => ({
  plugins: [createPinia()],
  stubs: {
    AlertDialog: realAlertDialog ? false : passthrough('AlertDialog'),
    AlertDialogAction: realAlertDialog ? false : ButtonStub,
    AlertDialogCancel: realAlertDialog ? false : ButtonStub,
    AlertDialogContent: realAlertDialog ? false : passthrough('AlertDialogContent'),
    AlertDialogDescription: realAlertDialog ? false : passthrough('AlertDialogDescription'),
    AlertDialogFooter: realAlertDialog ? false : passthrough('AlertDialogFooter'),
    AlertDialogHeader: realAlertDialog ? false : passthrough('AlertDialogHeader'),
    AlertDialogTitle: realAlertDialog ? false : passthrough('AlertDialogTitle'),
    Badge: passthrough('Badge'),
    DcButton: ButtonStub,
    Checkbox: passthrough('Checkbox'),
    Dialog: passthrough('Dialog'),
    DialogContent: passthrough('DialogContent'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle'),
    Icon: true,
    Input: InputStub,
    RadioGroup: passthrough('RadioGroup'),
    RadioGroupItem: passthrough('RadioGroupItem'),
    Spinner: passthrough('Spinner'),
    Tabs: passthrough('Tabs'),
    TabsContent: passthrough('TabsContent'),
    TabsList: passthrough('TabsList'),
    TabsTrigger: passthrough('TabsTrigger')
  }
})

describe('Agent-scoped Skill install dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mocks.skillClient.onCatalogChanged.mockReturnValue(() => undefined)
  })

  it('does not install a picked folder after the target Agent changes', async () => {
    const picker = deferred<{ canceled: boolean; filePaths: string[] }>()
    mocks.deviceClient.selectDirectory.mockReturnValue(picker.promise)
    const wrapper = mount(SkillInstallDialog, {
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions()
    })

    await wrapper.get('.border-dashed').trigger('click')
    await wrapper.setProps({ agentId: 'agent-b' })
    picker.resolve({ canceled: false, filePaths: ['/skills/source'] })
    await flushPromises()

    expect(mocks.skillClient.installFromFolder).not.toHaveBeenCalled()
  })

  it('settles an install after its dialog target changes without mutating the new target', async () => {
    const install = deferred<{ success: boolean; skillName: string }>()
    mocks.deviceClient.selectDirectory.mockResolvedValue({
      canceled: false,
      filePaths: ['/skills/source']
    })
    mocks.skillClient.installFromFolder.mockReturnValue(install.promise)
    const wrapper = mount(SkillInstallDialog, {
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions()
    })

    await wrapper.get('.border-dashed').trigger('click')
    await flushPromises()
    expect((wrapper.vm as any).installing).toBe(true)

    await wrapper.setProps({ agentId: 'agent-b' })
    install.resolve({ success: true, skillName: 'source' })
    await flushPromises()

    expect((wrapper.vm as any).installing).toBe(false)
    expect(mocks.notifyRenderer).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('ignores stale Git scans and settles installs after the target Agent changes', async () => {
    const staleScan = deferred<{
      repoUrl: string
      repoFormat: 'single-skill'
      skills: Array<{
        name: string
        description: string
        relativePath: string
        conflict: boolean
        valid: boolean
      }>
    }>()
    mocks.skillClient.scanGitSkillRepo.mockReturnValueOnce(staleScan.promise)
    const wrapper = mount(InstallFromGitDialog, {
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions()
    })

    const findButton = (key: string) =>
      wrapper.findAll('button').find((button) => button.text().includes(key))
    await findButton('settings.skills.git.scan')?.trigger('click')
    await wrapper.setProps({ agentId: 'agent-b' })
    staleScan.resolve({
      repoUrl: 'https://example.com/skills.git',
      repoFormat: 'single-skill',
      skills: [
        {
          name: 'stale-skill',
          description: 'Stale',
          relativePath: 'SKILL.md',
          conflict: false,
          valid: true
        }
      ]
    })
    await flushPromises()

    expect(mocks.skillClient.scanGitSkillRepo).toHaveBeenCalledWith(
      'https://github.com/op7418/guizang-ppt-skill',
      'agent-a'
    )
    expect(wrapper.text()).not.toContain('stale-skill')

    mocks.skillClient.scanGitSkillRepo.mockResolvedValueOnce({
      repoUrl: 'https://example.com/skills.git',
      repoFormat: 'single-skill',
      skills: [
        {
          name: 'current-skill',
          description: 'Current',
          relativePath: 'SKILL.md',
          conflict: false,
          valid: true
        }
      ]
    })
    await findButton('settings.skills.git.scan')?.trigger('click')
    await flushPromises()

    const staleInstall = deferred<Array<{ success: boolean; skillName: string }>>()
    mocks.skillClient.installFromGit.mockReturnValueOnce(staleInstall.promise)
    await findButton('settings.skills.git.install')?.trigger('click')
    await wrapper.setProps({ agentId: 'agent-c' })
    staleInstall.resolve([{ success: true, skillName: 'current-skill' }])
    await flushPromises()

    expect(mocks.skillClient.installFromGit).toHaveBeenCalledWith(
      {
        repoUrl: 'https://example.com/skills.git',
        skillNames: ['current-skill'],
        strategy: 'rename'
      },
      'agent-b'
    )
    expect((wrapper.vm as any).installing).toBe(false)
    expect(mocks.notifyRenderer).not.toHaveBeenCalled()
  })

  it('clears a scanned Git preview when the repository URL changes', async () => {
    mocks.skillClient.scanGitSkillRepo.mockResolvedValueOnce({
      repoUrl: 'https://example.com/repo-a.git',
      repoFormat: 'single-skill',
      skills: [
        {
          name: 'repo-a-skill',
          description: 'Repository A',
          relativePath: 'SKILL.md',
          conflict: false,
          valid: true
        }
      ]
    })
    const wrapper = mount(InstallFromGitDialog, {
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions()
    })
    const findButton = (key: string) =>
      wrapper.findAll('button').find((button) => button.text().includes(key))

    await findButton('settings.skills.git.scan')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('repo-a-skill')

    wrapper.findComponent(InputStub).vm.$emit('update:modelValue', 'https://example.com/repo-b.git')
    await flushPromises()

    expect(wrapper.text()).not.toContain('repo-a-skill')
    const installButton = findButton('settings.skills.git.install')
    expect(installButton?.attributes('disabled')).toBeDefined()
    await installButton?.trigger('click')
    expect(mocks.skillClient.installFromGit).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight Git scan when the repository URL changes', async () => {
    const staleScan = deferred<{
      repoUrl: string
      repoFormat: 'single-skill'
      skills: Array<{
        name: string
        description: string
        relativePath: string
        conflict: boolean
        valid: boolean
      }>
    }>()
    mocks.skillClient.scanGitSkillRepo.mockReturnValueOnce(staleScan.promise)
    const wrapper = mount(InstallFromGitDialog, {
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions()
    })
    const findButton = (key: string) =>
      wrapper.findAll('button').find((button) => button.text().includes(key))

    await findButton('settings.skills.git.scan')?.trigger('click')
    wrapper.findComponent(InputStub).vm.$emit('update:modelValue', 'https://example.com/repo-b.git')
    await flushPromises()
    staleScan.resolve({
      repoUrl: 'https://example.com/repo-a.git',
      repoFormat: 'single-skill',
      skills: [
        {
          name: 'stale-skill',
          description: 'Stale',
          relativePath: 'SKILL.md',
          conflict: false,
          valid: true
        }
      ]
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('stale-skill')
    expect(findButton('settings.skills.git.install')?.attributes('disabled')).toBeDefined()
  })

  it('settles the conflict attempt before starting an overwrite install', async () => {
    const overwrite = deferred<{ success: boolean; skillName: string }>()
    mocks.deviceClient.selectDirectory.mockResolvedValue({
      canceled: false,
      filePaths: ['/skills/source']
    })
    mocks.skillClient.installFromFolder
      .mockResolvedValueOnce({
        success: false,
        errorCode: 'conflict',
        existingSkillName: 'source'
      })
      .mockReturnValueOnce(overwrite.promise)
    const wrapper = mount(SkillInstallDialog, {
      attachTo: document.body,
      props: { open: true, agentId: 'agent-a' },
      global: globalOptions(true)
    })

    await wrapper.get('.border-dashed').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="skill-conflict-overwrite"]')!.click()
    await flushPromises()

    expect(mocks.skillClient.installFromFolder).toHaveBeenNthCalledWith(
      1,
      '/skills/source',
      { overwrite: false },
      'agent-a'
    )
    expect(mocks.skillClient.installFromFolder).toHaveBeenNthCalledWith(
      2,
      '/skills/source',
      { overwrite: true },
      'agent-a'
    )
    expect(wrapper.findComponent({ name: 'Spinner' }).exists()).toBe(true)
    await wrapper.get('.border-dashed').trigger('click')
    expect(mocks.deviceClient.selectDirectory).toHaveBeenCalledOnce()
    expect(mocks.skillClient.installFromFolder).toHaveBeenCalledTimes(2)

    overwrite.resolve({
      success: true,
      skillName: 'source'
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'Spinner' }).exists()).toBe(false)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
    wrapper.unmount()
  })
})
