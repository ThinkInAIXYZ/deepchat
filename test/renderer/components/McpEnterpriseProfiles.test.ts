import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listEnterpriseProfiles, saveEnterpriseProfile } = vi.hoisted(() => ({
  listEnterpriseProfiles: vi.fn().mockResolvedValue([]),
  saveEnterpriseProfile: vi.fn(async (profile) => profile)
}))

vi.mock('@api/McpClient', () => ({
  createMcpClient: () => ({
    listEnterpriseProfiles,
    saveEnterpriseProfile,
    getEnterpriseProfileStatus: vi.fn(),
    setEnterpriseProfileClientSecret: vi.fn(),
    startEnterpriseProfileAuth: vi.fn(),
    completeEnterpriseProfileAuth: vi.fn(),
    logoutEnterpriseProfile: vi.fn(),
    removeEnterpriseProfile: vi.fn(),
    onEnterpriseAuthChanged: vi.fn(() => vi.fn())
  })
}))

vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer: vi.fn()
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'profile-id'
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const formActionsStub = defineComponent({
  name: 'DcFormActions',
  emits: ['cancel'],
  template: '<button type="submit">common.save</button>'
})

const mountProfiles = async () => {
  const McpEnterpriseProfiles = (
    await import('../../../src/renderer/src/components/mcp-config/components/McpEnterpriseProfiles.vue')
  ).default

  return mount(McpEnterpriseProfiles, {
    global: {
      stubs: {
        Dialog: passthrough('Dialog'),
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        DialogTrigger: passthrough('DialogTrigger'),
        DcFormActions: formActionsStub,
        Icon: true,
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue')
      }
    }
  })
}

const startCreate = async (wrapper: Awaited<ReturnType<typeof mountProfiles>>) => {
  const addButton = wrapper.findAll('button').find((button) => button.text().includes('common.add'))

  expect(addButton).toBeDefined()
  await addButton!.trigger('click')
}

describe('McpEnterpriseProfiles', () => {
  beforeEach(() => {
    listEnterpriseProfiles.mockClear()
    saveEnterpriseProfile.mockClear()
  })

  it('shows vee-validate errors and rejects missing required fields', async () => {
    const wrapper = await mountProfiles()
    await startCreate(wrapper)

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-slot="form-message"]')).toHaveLength(3)
    })

    expect(saveEnterpriseProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('components.promptParamsDialog.required')
  })

  it('saves a complete profile with the existing defaults', async () => {
    const wrapper = await mountProfiles()
    await startCreate(wrapper)

    await wrapper.get('input[name="label"]').setValue('Corporate SSO')
    await wrapper.get('input[name="issuer"]').setValue('https://id.example.com')
    await wrapper.get('input[name="clientId"]').setValue('deepchat-desktop')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(saveEnterpriseProfile).toHaveBeenCalledOnce()
    })
    expect(saveEnterpriseProfile).toHaveBeenCalledWith({
      id: 'enterprise-profile-id',
      label: 'Corporate SSO',
      issuer: 'https://id.example.com',
      clientId: 'deepchat-desktop',
      scopes: ['openid'],
      clientAuthentication: 'none'
    })
  })
})
