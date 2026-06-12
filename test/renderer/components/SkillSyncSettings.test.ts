import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { NewDiscovery } from '@shared/types/skillSync'

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
})
