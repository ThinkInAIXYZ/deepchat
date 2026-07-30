import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type {
  SurfaceFeedbackController,
  SurfaceFeedbackResult,
  SurfaceFeedbackSnapshot
} from '@renderer-notifications/surfaceFeedbackController'

const systemPromptStore = vi.hoisted(() => ({
  prompts: [] as Array<Record<string, unknown>>,
  defaultPromptId: 'default',
  loadPrompts: vi.fn(),
  setDefaultSystemPromptId: vi.fn(),
  updateSystemPrompt: vi.fn(),
  resetToDefaultPrompt: vi.fn(),
  addSystemPrompt: vi.fn(),
  deleteSystemPrompt: vi.fn()
}))

const promptsStore = vi.hoisted(() => ({
  prompts: [] as Array<Record<string, unknown>>,
  loadPrompts: vi.fn(),
  savePrompts: vi.fn(),
  addPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn()
}))

vi.mock('@/stores/systemPromptStore', () => ({
  useSystemPromptStore: () => systemPromptStore
}))
vi.mock('@/stores/prompts', () => ({
  usePromptsStore: () => promptsStore
}))
vi.mock('nanoid', () => ({
  nanoid: () => 'test-scope'
}))
vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    template: '<span />'
  }
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    props: {
      open: { type: Boolean, default: true }
    },
    template: '<div v-if="open"><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: {
    modelValue: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'blur'],
  template:
    '<textarea :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" />'
})

const InlineFeedbackStub = defineComponent({
  name: 'InlineOperationFeedback',
  props: {
    snapshot: { type: Object, required: true }
  },
  template: '<div data-testid="feedback">{{ snapshot.status }}:{{ snapshot.title }}</div>'
})

const SystemPromptEditorStub = defineComponent({
  name: 'SystemPromptEditorSheet',
  props: {
    open: { type: Boolean, default: false }
  },
  template: '<div v-if="open" />'
})

const PromptEditorStub = defineComponent({
  name: 'PromptEditorSheet',
  props: {
    open: { type: Boolean, default: false }
  },
  emits: ['submit', 'update:open'],
  template: `
    <div v-if="open" data-testid="prompt-editor">
      <button
        data-testid="submit-prompt"
        @click="$emit('submit', {
          id: '',
          name: 'Writer',
          description: '',
          content: 'Write clearly',
          parameters: [],
          files: [],
          enabled: true,
          source: 'local'
        })"
      >
        submit
      </button>
    </div>
  `
})

type FeedbackHarness = {
  controller: SurfaceFeedbackController
  connect(wrapper: VueWrapper): void
  getSnapshot(): SurfaceFeedbackSnapshot
}

const createFeedbackHarness = (): FeedbackHarness => {
  let snapshot: SurfaceFeedbackSnapshot = Object.freeze({ status: 'idle', version: 0 })
  let wrapper: VueWrapper | undefined
  const transition = (next: SurfaceFeedbackSnapshot) => {
    snapshot = next
    if (wrapper) {
      void wrapper.setProps({ feedback: next })
    }
  }
  const controller = {
    getSnapshot: () => snapshot,
    begin: (operationId: string, label: string) => {
      transition({
        status: 'pending',
        operationId,
        label,
        version: snapshot.version + 1
      })
    },
    succeed: (result: SurfaceFeedbackResult) => {
      if (snapshot.status !== 'pending') throw new Error('feedback is not pending')
      transition({
        status: 'success',
        operationId: snapshot.operationId,
        ...result,
        version: snapshot.version + 1
      })
    },
    fail: (result: SurfaceFeedbackResult) => {
      if (snapshot.status !== 'pending') throw new Error('feedback is not pending')
      transition({
        status: 'error',
        operationId: snapshot.operationId,
        ...result,
        version: snapshot.version + 1
      })
    },
    clearSettled: () => {
      transition({ status: 'idle', version: snapshot.version + 1 })
    }
  } as SurfaceFeedbackController

  return {
    controller,
    connect(nextWrapper) {
      wrapper = nextWrapper
    },
    getSnapshot: () => snapshot
  }
}

const globalStubs = {
  Button: ButtonStub,
  Label: passthrough('Label'),
  Textarea: TextareaStub,
  Select: passthrough('Select'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  Dialog: passthrough('Dialog'),
  DialogContent: passthrough('DialogContent'),
  DialogHeader: passthrough('DialogHeader'),
  DialogTitle: passthrough('DialogTitle'),
  DialogDescription: passthrough('DialogDescription'),
  DialogFooter: passthrough('DialogFooter'),
  InlineOperationFeedback: InlineFeedbackStub,
  SystemPromptEditorSheet: SystemPromptEditorStub,
  PromptEditorSheet: PromptEditorStub,
  Icon: true
}

describe('prompt settings feedback', () => {
  it('keeps a failed inline system prompt save dirty and discardable', async () => {
    vi.resetModules()
    const initialState = {
      prompts: [
        {
          id: 'default',
          name: 'Default',
          content: 'Persisted content',
          isDefault: true
        }
      ],
      defaultPromptId: 'default'
    }
    systemPromptStore.loadPrompts.mockReset().mockResolvedValue(initialState)
    systemPromptStore.updateSystemPrompt
      .mockReset()
      .mockRejectedValue(new Error('secret backend detail'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const feedback = createFeedbackHarness()
    const SystemPromptSettingsSection = (
      await import('../../../src/renderer/settings/components/prompt/SystemPromptSettingsSection.vue')
    ).default
    const wrapper = mount(SystemPromptSettingsSection, {
      props: {
        feedbackController: feedback.controller,
        feedback: feedback.getSnapshot(),
        blocked: false
      },
      global: {
        stubs: globalStubs
      }
    })
    feedback.connect(wrapper)
    await flushPromises()

    const textarea = wrapper.get('textarea')
    await textarea.setValue('Unsaved draft')
    await textarea.trigger('blur')
    await flushPromises()

    expect(systemPromptStore.updateSystemPrompt).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ content: 'Unsaved draft' })
    )
    expect(feedback.getSnapshot()).toMatchObject({
      status: 'error',
      title: 'promptSetting.systemPromptSaveFailed'
    })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Unsaved draft')

    const { settingsLeaveGuard } =
      await import('../../../src/renderer/settings/services/settingsLeaveGuard')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    const leave = settingsLeaveGuard.requestLeave()
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    await nextTick()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Persisted content')
    expect(feedback.getSnapshot().status).toBe('idle')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret backend detail')

    wrapper.unmount()
    consoleError.mockRestore()
  })

  it('keeps the custom prompt editor open when persistence fails', async () => {
    vi.resetModules()
    promptsStore.prompts = []
    promptsStore.loadPrompts.mockReset().mockResolvedValue([])
    promptsStore.addPrompt.mockReset().mockRejectedValue(new Error('private storage path'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const feedback = createFeedbackHarness()
    const CustomPromptSettingsSection = (
      await import('../../../src/renderer/settings/components/prompt/CustomPromptSettingsSection.vue')
    ).default
    const wrapper = mount(CustomPromptSettingsSection, {
      props: {
        feedbackController: feedback.controller,
        feedback: feedback.getSnapshot(),
        blocked: false
      },
      global: {
        stubs: globalStubs
      }
    })
    feedback.connect(wrapper)
    await flushPromises()

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('promptSetting.addCustomPrompt'))
    expect(addButton).toBeDefined()
    await addButton!.trigger('click')
    await wrapper.get('[data-testid="submit-prompt"]').trigger('click')
    await flushPromises()

    expect(promptsStore.addPrompt).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="prompt-editor"]').exists()).toBe(true)
    expect(feedback.getSnapshot()).toMatchObject({
      status: 'error',
      title: 'common.error.operationFailed'
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private storage path')

    wrapper.unmount()
    consoleError.mockRestore()
  })

  it('does not open import while the canonical prompt list is unavailable', async () => {
    vi.resetModules()
    promptsStore.prompts = []
    promptsStore.loadPrompts.mockReset().mockRejectedValue(new Error('storage unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createElement = vi.spyOn(document, 'createElement')
    const feedback = createFeedbackHarness()
    const CustomPromptSettingsSection = (
      await import('../../../src/renderer/settings/components/prompt/CustomPromptSettingsSection.vue')
    ).default
    const wrapper = mount(CustomPromptSettingsSection, {
      props: {
        feedbackController: feedback.controller,
        feedback: feedback.getSnapshot(),
        blocked: false
      },
      global: {
        stubs: globalStubs
      }
    })
    feedback.connect(wrapper)
    await flushPromises()
    createElement.mockClear()

    const exposed = wrapper.vm as unknown as { importPrompts(): void }
    exposed.importPrompts()

    expect(createElement).not.toHaveBeenCalled()
    expect(wrapper.emitted('ready-change')?.at(-1)).toEqual([false])

    wrapper.unmount()
    createElement.mockRestore()
    consoleError.mockRestore()
  })

  it('drops untrusted local paths from imported prompt attachments', async () => {
    vi.resetModules()
    promptsStore.prompts = []
    promptsStore.loadPrompts.mockReset().mockResolvedValue([])
    promptsStore.savePrompts.mockReset().mockImplementation(async (prompts) => prompts)
    const feedback = createFeedbackHarness()
    const CustomPromptSettingsSection = (
      await import('../../../src/renderer/settings/components/prompt/CustomPromptSettingsSection.vue')
    ).default
    const wrapper = mount(CustomPromptSettingsSection, {
      props: {
        feedbackController: feedback.controller,
        feedback: feedback.getSnapshot(),
        blocked: false
      },
      global: {
        stubs: globalStubs
      }
    })
    feedback.connect(wrapper)
    await flushPromises()

    const inputElement = {
      type: '',
      accept: '',
      onchange: null as ((event: Event) => void | Promise<void>) | null,
      click: vi.fn()
    }
    const originalCreateElement = document.createElement.bind(document)
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        if (tagName === 'input') {
          return inputElement as unknown as HTMLInputElement
        }
        return originalCreateElement(tagName, options)
      })
    const exposed = wrapper.vm as unknown as { importPrompts(): void }
    exposed.importPrompts()
    const importedFile = new File(
      [
        JSON.stringify([
          {
            id: 'imported',
            name: 'Imported',
            description: '',
            content: 'Use context',
            files: [
              {
                id: 'attachment',
                name: 'secrets.txt',
                type: 'text/plain',
                size: 10,
                path: 'agent.db',
                createdAt: 1
              }
            ]
          }
        ])
      ],
      'prompts.json',
      { type: 'application/json' }
    )
    await inputElement.onchange?.({
      target: {
        files: [importedFile]
      }
    } as unknown as Event)
    await vi.waitFor(() => {
      expect(promptsStore.savePrompts).toHaveBeenCalledTimes(1)
    })

    const saved = promptsStore.savePrompts.mock.calls[0]?.[0] as Array<{
      files?: Array<{ path: string }>
    }>
    expect(saved[0]?.files?.[0]?.path).toBe('')

    wrapper.unmount()
    createElement.mockRestore()
  })
})
