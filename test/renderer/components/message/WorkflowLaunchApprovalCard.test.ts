import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKFLOW_EVENTS } from '@/events'

const sourceHash = 'a'.repeat(64)
const client = vi.hoisted(() => ({
  validateLaunchApproval: vi.fn(),
  revokeLaunchApproval: vi.fn(),
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

import WorkflowLaunchApprovalCard from '@/components/message/WorkflowLaunchApprovalCard.vue'

const approval = {
  approvalId: '50d6dbb8-45cb-4a76-af9c-9137cb4695ac',
  sourceHash,
  scopeHash: 'b'.repeat(64),
  expiresAt: Date.now() + 60_000,
  summary: {
    workspacePath: '/repo',
    capabilityScopeHash: 'c'.repeat(64),
    executionSnapshotHash: 'd'.repeat(64),
    allowedAgentIds: ['deepchat', 'reviewer'],
    maxInvocations: 8,
    maxPendingInvocations: 4,
    budget: { maxExecutionMs: 2 * 60 * 60 * 1_000 },
    capabilities: ['deepchat-child-sessions'],
    outline: {
      schemaVersion: 1 as const,
      confidence: 'exact' as const,
      truncated: false,
      nodes: []
    }
  }
}

describe('WorkflowLaunchApprovalCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    approval.expiresAt = Date.now() + 60_000
    client.validateLaunchApproval.mockResolvedValue(approval)
    client.revokeLaunchApproval.mockResolvedValue(true)
    client.launch.mockResolvedValue({ id: 'run-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates the parent-scoped approval before enabling exact-ID launch', async () => {
    const openListener = vi.fn()
    window.addEventListener(WORKFLOW_EVENTS.OPEN_REQUESTED, openListener)
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })

    expect(wrapper.find('[data-testid="workflow-approval-launch"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workflow-approval-checking"]').exists()).toBe(true)
    await flushPromises()
    expect(client.validateLaunchApproval).toHaveBeenCalledWith(
      'parent-1',
      approval.approvalId,
      'return null'
    )
    expect(
      wrapper.get('[data-testid="workflow-approval-launch"]').attributes('disabled')
    ).toBeUndefined()
    expect(wrapper.text()).toContain('chat.workflow.budget.duration')
    expect(wrapper.text()).toContain('chat.workflow.duration.hours')

    await wrapper.get('[data-testid="workflow-approval-launch"]').trigger('click')
    await wrapper.get('[data-testid="workflow-approval-launch"]').trigger('click')
    await flushPromises()

    expect(client.launch).toHaveBeenCalledTimes(1)
    expect(client.launch).toHaveBeenCalledWith('parent-1', approval.approvalId)
    expect(openListener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { sessionId: 'parent-1', runId: 'run-1' } })
    )
    expect(wrapper.text()).toContain('chat.workflow.approval.launched')

    window.removeEventListener(WORKFLOW_EVENTS.OPEN_REQUESTED, openListener)
    wrapper.unmount()
  })

  it('revokes the old approval before staging bounded revision feedback', async () => {
    const reviseListener = vi.fn()
    window.addEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="workflow-approval-revise"]').trigger('click')
    await wrapper.get('[data-testid="workflow-approval-feedback"]').setValue('Use three reviewers')
    await wrapper.get('[data-testid="workflow-approval-regenerate"]').trigger('click')
    await flushPromises()

    expect(client.revokeLaunchApproval).toHaveBeenCalledWith('parent-1', approval.approvalId)
    expect(reviseListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          sessionId: 'parent-1',
          text: expect.stringContaining('Use three reviewers')
        })
      })
    )
    expect(client.launch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('chat.workflow.approval.revisionRequested')

    window.removeEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    wrapper.unmount()
  })

  it('fails closed on validation errors and still revokes a live approval before revision', async () => {
    client.validateLaunchApproval.mockRejectedValueOnce(new Error('source mismatch'))
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'tampered source'
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="workflow-approval-unavailable"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-approval-launch"]').attributes('disabled')).toBe('')

    await wrapper.get('[data-testid="workflow-approval-revise"]').trigger('click')
    await wrapper.get('[data-testid="workflow-approval-feedback"]').setValue('Regenerate safely')
    await wrapper.get('[data-testid="workflow-approval-regenerate"]').trigger('click')
    await flushPromises()

    expect(client.revokeLaunchApproval).toHaveBeenCalledWith('parent-1', approval.approvalId)
    expect(client.launch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('fails closed when validation returns a different approval identity', async () => {
    client.validateLaunchApproval.mockResolvedValueOnce({
      ...approval,
      approvalId: '3d52ca89-4249-4a6d-8838-2e7295eb965f'
    })
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="workflow-approval-unavailable"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="workflow-approval-launch"]').attributes('disabled')).toBe('')
    expect(client.launch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocks immediate revision when launch completion cannot be confirmed', async () => {
    client.launch.mockRejectedValueOnce(new Error('IPC response lost'))
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="workflow-approval-launch"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('chat.workflow.approval.launchUnconfirmed')
    expect(wrapper.find('[data-testid="workflow-approval-revise"]').exists()).toBe(false)
    expect(client.launch).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not stage a revision when a live approval can no longer be revoked', async () => {
    client.validateLaunchApproval.mockRejectedValueOnce(new Error('approval missing'))
    client.revokeLaunchApproval.mockResolvedValueOnce(false)
    const reviseListener = vi.fn()
    window.addEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="workflow-approval-revise"]').trigger('click')
    await wrapper.get('[data-testid="workflow-approval-feedback"]').setValue('Change the plan')
    await wrapper.get('[data-testid="workflow-approval-regenerate"]').trigger('click')
    await flushPromises()

    expect(reviseListener).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('chat.workflow.approval.launchUnconfirmed')
    expect(wrapper.find('[data-testid="workflow-approval-revise"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workflow-approval-feedback"]').exists()).toBe(false)

    window.removeEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    wrapper.unmount()
  })

  it('enforces the revision feedback bound in the action handler', async () => {
    const reviseListener = vi.fn()
    window.addEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval,
        scriptSource: 'return null'
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="workflow-approval-revise"]').trigger('click')
    await wrapper.get('[data-testid="workflow-approval-feedback"]').setValue('x'.repeat(8_193))
    await wrapper.get('[data-testid="workflow-approval-regenerate"]').trigger('click')
    await flushPromises()

    expect(client.revokeLaunchApproval).not.toHaveBeenCalled()
    expect(reviseListener).not.toHaveBeenCalled()

    window.removeEventListener(WORKFLOW_EVENTS.REVISE_REQUESTED, reviseListener)
    wrapper.unmount()
  })

  it('keeps source lazy and disables stale or read-only approvals', async () => {
    const expiredApproval = { ...approval, expiresAt: Date.now() - 1 }
    const wrapper = mount(WorkflowLaunchApprovalCard, {
      props: {
        threadId: 'parent-1',
        approval: expiredApproval,
        scriptSource: 'secret workflow source',
        readOnly: true
      }
    })
    await flushPromises()

    expect(client.validateLaunchApproval).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="workflow-approval-source"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="workflow-approval-revise"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workflow-approval-launch"]').attributes('disabled')).toBe('')

    await wrapper.get('[data-testid="workflow-approval-source-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="workflow-approval-source"]').text()).toBe(
      'secret workflow source'
    )
    wrapper.unmount()
  })
})
