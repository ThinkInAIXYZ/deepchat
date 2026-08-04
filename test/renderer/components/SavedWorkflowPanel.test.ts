import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunSummary } from '@shared/workflow/projection'
import { deleteWorkflowAuthoringDraft } from '@/lib/workflowAuthoringDraftStore'

const client = vi.hoisted(() => ({
  listSaved: vi.fn(),
  readSaved: vi.fn(),
  saveSaved: vi.fn(),
  prepareSavedLaunch: vi.fn(),
  launch: vi.fn()
}))

vi.mock('@api/WorkflowClient', () => ({
  createWorkflowClient: () => client
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<i />'
  })
}))

vi.mock('@shadcn/components/ui/button', () => ({
  Button: defineComponent({
    name: 'Button',
    emits: ['click'],
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
  })
}))

vi.mock('@shadcn/components/ui/input', () => ({
  Input: defineComponent({
    name: 'Input',
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue'],
    template:
      '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })
}))

vi.mock('@shadcn/components/ui/textarea', () => ({
  Textarea: defineComponent({
    name: 'Textarea',
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue'],
    template:
      '<textarea v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })
}))

import SavedWorkflowPanel from '@/components/sidepanel/SavedWorkflowPanel.vue'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const savedDocument = {
  name: 'review',
  relativePath: '.deepchat/workflows/review.js',
  absolutePath: '/repo/.deepchat/workflows/review.js',
  sourceHash: 'd'.repeat(64),
  source: 'return await agent(input.prompt, { key: "review" })',
  byteLength: 51,
  updatedAt: 100
}

const workflowDirectory = '/repo/.deepchat/workflows'

const approval = {
  approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
  sourceHash: savedDocument.sourceHash,
  scopeHash: 'b'.repeat(64),
  expiresAt: Date.now() + 60_000,
  summary: {
    workspacePath: '/repo',
    capabilityScopeHash: 'c'.repeat(64),
    allowedAgentIds: ['deepchat'],
    maxInvocations: 128,
    maxPendingInvocations: 64,
    budget: {
      maxExecutionMs: 2 * 60 * 60 * 1_000
    },
    capabilities: ['deepchat-child-sessions'],
    outline: {
      schemaVersion: 1,
      confidence: 'exact',
      truncated: false,
      nodes: []
    }
  }
}

describe('SavedWorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteWorkflowAuthoringDraft('parent-1', workflowDirectory)
    deleteWorkflowAuthoringDraft('parent-2', workflowDirectory)
  })

  afterEach(() => {
    vi.useRealTimers()
    deleteWorkflowAuthoringDraft('parent-1', workflowDirectory)
    deleteWorkflowAuthoringDraft('parent-2', workflowDirectory)
  })

  it('shows that saved workflows require a main-resolved workspace', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: null,
      workflows: []
    })
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="saved-workflow-unavailable"]').text()).toContain(
      'chat.workflow.saved.workspaceRequired'
    )
    wrapper.unmount()
  })

  it('saves, approves, and launches the exact loaded source snapshot', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: []
    })
    client.saveSaved.mockResolvedValue(savedDocument)
    client.prepareSavedLaunch.mockResolvedValue({
      ...approval,
      summary: {
        ...approval.summary,
        outline: {
          schemaVersion: 1,
          confidence: 'exact',
          truncated: false,
          nodes: [
            {
              id: 'outline-1',
              ordinal: 1,
              kind: 'agent',
              key: 'review',
              label: 'Review',
              itemCount: null,
              stageCount: null,
              concurrency: null,
              dynamic: false
            }
          ]
        }
      }
    })
    const launchedRun = {
      id: 'run-1',
      parentSessionId: 'parent-1',
      status: 'queued'
    } as WorkflowRunSummary
    client.launch.mockResolvedValue(launchedRun)

    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="saved-workflow-new"]').trigger('click')
    await wrapper.get('[data-testid="saved-workflow-name"]').setValue('review')
    await wrapper.get('[data-testid="saved-workflow-source"]').setValue(savedDocument.source)
    await wrapper.get('[data-testid="saved-workflow-save"]').trigger('click')
    await flushPromises()

    expect(client.saveSaved).toHaveBeenCalledWith('parent-1', {
      name: 'review',
      source: savedDocument.source,
      expectedSourceHash: null
    })

    await wrapper
      .get('[data-testid="saved-workflow-args"]')
      .setValue('{"prompt":"Inspect this change"}')
    await wrapper.get('[data-testid="saved-workflow-agents"]').setValue('deepchat, reviewer')
    await wrapper.get('[data-testid="saved-workflow-prepare"]').trigger('click')
    await flushPromises()

    expect(client.prepareSavedLaunch).toHaveBeenCalledWith('parent-1', {
      name: 'review',
      argsText: '{"prompt":"Inspect this change"}',
      expectedSourceHash: savedDocument.sourceHash,
      allowedAgentIds: ['deepchat', 'reviewer']
    })
    expect(wrapper.get('[data-testid="saved-workflow-approval"]').text()).toContain(
      savedDocument.sourceHash
    )
    expect(wrapper.get('[data-testid="saved-workflow-approval"]').text()).toContain('64')
    expect(wrapper.get('[data-testid="saved-workflow-approval"]').text()).toContain(
      'chat.workflow.budget.duration'
    )
    expect(wrapper.get('[data-testid="saved-workflow-approval"]').text()).toContain(
      'chat.workflow.duration.hours'
    )
    expect(wrapper.get('[data-testid="saved-workflow-capabilities"]').text()).toContain(
      'deepchat-child-sessions'
    )
    expect(wrapper.get('[data-testid="saved-workflow-outline"]').text()).toContain('agent · Review')

    await wrapper.get('[data-testid="saved-workflow-launch"]').trigger('click')
    await flushPromises()

    expect(client.launch).toHaveBeenCalledWith('parent-1', approval.approvalId)
    expect(wrapper.emitted('launched')).toEqual([[launchedRun]])
    expect(wrapper.find('[data-testid="saved-workflow-approval"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('requires edited source to be saved before a launch can be prepared', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValue(savedDocument)
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper
      .get('[data-testid="saved-workflow-source"]')
      .setValue(`${savedDocument.source}\nreturn null`)

    expect(
      wrapper.get('[data-testid="saved-workflow-prepare"]').attributes('disabled')
    ).toBeDefined()
    expect(client.prepareSavedLaunch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('lets a new unsaved draft be discarded without trapping the editor', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: []
    })
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="saved-workflow-new"]').trigger('click')
    expect(wrapper.get('[data-testid="saved-workflow-editor"]').exists()).toBe(true)
    expect(
      wrapper.get('[data-testid="saved-workflow-select"]').attributes('disabled')
    ).toBeDefined()

    await wrapper.get('[data-testid="saved-workflow-discard"]').trigger('click')

    expect(wrapper.find('[data-testid="saved-workflow-editor"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="saved-workflow-select"]').attributes('disabled')).toBe(
      undefined
    )
    wrapper.unmount()
  })

  it('consumes a slash invocation only after preparing the exact saved source', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValue(savedDocument)
    client.prepareSavedLaunch.mockResolvedValue(approval)

    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1',
        invocationRequest: {
          id: 7,
          name: 'review',
          argsText: '{"target":"src"}'
        }
      }
    })
    await flushPromises()

    expect(client.readSaved).toHaveBeenCalledWith('parent-1', 'review')
    expect(client.prepareSavedLaunch).toHaveBeenCalledWith('parent-1', {
      name: 'review',
      argsText: '{"target":"src"}',
      expectedSourceHash: savedDocument.sourceHash
    })
    expect(wrapper.emitted('consumed')).toEqual([[7]])
    expect(wrapper.get('[data-testid="saved-workflow-approval"]').exists()).toBe(true)
    expect(client.launch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('retains a slash invocation when its saved workflow cannot be resolved', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: []
    })
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1',
        invocationRequest: {
          id: 6,
          name: 'missing',
          argsText: '{}'
        }
      }
    })
    await flushPromises()

    expect(client.readSaved).not.toHaveBeenCalled()
    expect(client.prepareSavedLaunch).not.toHaveBeenCalled()
    expect(wrapper.emitted('consumed')).toBeUndefined()
    expect(wrapper.text()).toContain('common.error.requestFailed')
    wrapper.unmount()
  })

  it('does not discard unsaved source when a slash invocation arrives', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValue(savedDocument)
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    const editedSource = `${savedDocument.source}\nlog("local edit")`
    await wrapper.get('[data-testid="saved-workflow-source"]').setValue(editedSource)
    await wrapper.setProps({
      invocationRequest: {
        id: 8,
        name: 'review',
        argsText: '{}'
      }
    })
    await flushPromises()

    expect(client.readSaved).toHaveBeenCalledTimes(1)
    expect(client.prepareSavedLaunch).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="saved-workflow-source"]').element).toHaveProperty(
      'value',
      editedSource
    )
    expect(wrapper.emitted('consumed')).toBeUndefined()
    expect(wrapper.text()).toContain('chat.workflow.saved.unsaved')
    wrapper.unmount()
  })

  it('restores a bounded in-memory dirty draft after the panel remounts', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValue(savedDocument)
    const first = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    const editedSource = `${savedDocument.source}\nlog("keep this edit")`
    await first.get('[data-testid="saved-workflow-source"]').setValue(editedSource)
    await first.get('[data-testid="saved-workflow-args"]').setValue('{"target":"src"}')
    first.unmount()

    const second = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    expect(client.readSaved).toHaveBeenCalledTimes(1)
    expect(second.get('[data-testid="saved-workflow-source"]').element).toHaveProperty(
      'value',
      editedSource
    )
    expect(second.get('[data-testid="saved-workflow-args"]').element).toHaveProperty(
      'value',
      '{"target":"src"}'
    )
    second.unmount()
  })

  it('keeps a blocked slash invocation until the dirty source is saved and prepared', async () => {
    const editedSource = `${savedDocument.source}\nlog("saved edit")`
    const updatedDocument = {
      ...savedDocument,
      source: editedSource,
      sourceHash: 'e'.repeat(64),
      byteLength: new TextEncoder().encode(editedSource).byteLength,
      updatedAt: 101
    }
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValueOnce(savedDocument).mockResolvedValueOnce(updatedDocument)
    client.saveSaved.mockResolvedValue(updatedDocument)
    client.prepareSavedLaunch.mockResolvedValue({
      ...approval,
      sourceHash: updatedDocument.sourceHash
    })
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="saved-workflow-source"]').setValue(editedSource)
    await wrapper.setProps({
      invocationRequest: {
        id: 9,
        name: 'review',
        argsText: '{"target":"src"}'
      }
    })
    await flushPromises()
    expect(wrapper.emitted('consumed')).toBeUndefined()

    await wrapper.get('[data-testid="saved-workflow-save"]').trigger('click')
    await flushPromises()

    expect(client.prepareSavedLaunch).toHaveBeenCalledWith('parent-1', {
      name: 'review',
      argsText: '{"target":"src"}',
      expectedSourceHash: updatedDocument.sourceHash
    })
    expect(wrapper.emitted('consumed')).toEqual([[9]])
    wrapper.unmount()
  })

  it('clears an expired approval instead of retaining a disabled launch contract', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T00:00:00.000Z'))
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: [
        {
          name: savedDocument.name,
          relativePath: savedDocument.relativePath,
          byteLength: savedDocument.byteLength,
          updatedAt: savedDocument.updatedAt
        }
      ]
    })
    client.readSaved.mockResolvedValue(savedDocument)
    client.prepareSavedLaunch.mockResolvedValue({
      ...approval,
      expiresAt: Date.now() + 500
    })
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="saved-workflow-prepare"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="saved-workflow-approval"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()

    expect(wrapper.find('[data-testid="saved-workflow-approval"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores save completions from a previously selected parent session', async () => {
    client.listSaved.mockResolvedValue({
      directoryPath: workflowDirectory,
      workflows: []
    })
    const pendingSave = createDeferred<typeof savedDocument>()
    client.saveSaved.mockReturnValue(pendingSave.promise)
    const savedChanged = vi.fn()
    window.addEventListener('workflow:saved-changed', savedChanged)
    const wrapper = mount(SavedWorkflowPanel, {
      props: {
        sessionId: 'parent-1'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="saved-workflow-new"]').trigger('click')
    await wrapper.get('[data-testid="saved-workflow-name"]').setValue('review')
    await wrapper.get('[data-testid="saved-workflow-source"]').setValue(savedDocument.source)
    await wrapper.get('[data-testid="saved-workflow-save"]').trigger('click')
    await wrapper.setProps({ sessionId: 'parent-2' })
    await flushPromises()

    pendingSave.resolve(savedDocument)
    await flushPromises()

    expect(client.saveSaved).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        name: 'review'
      })
    )
    expect(wrapper.find('[data-testid="saved-workflow-editor"]').exists()).toBe(false)
    expect(savedChanged).not.toHaveBeenCalled()

    window.removeEventListener('workflow:saved-changed', savedChanged)
    wrapper.unmount()
  })
})
