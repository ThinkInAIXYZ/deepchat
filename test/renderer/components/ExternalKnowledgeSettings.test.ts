import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    props: ['open'],
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const inlineFeedbackStub = defineComponent({
  name: 'InlineOperationFeedback',
  props: ['snapshot'],
  emits: ['retry'],
  template:
    '<div data-testid="knowledge-operation-feedback" :data-status="snapshot.status"><button data-testid="knowledge-operation-retry" @click="$emit(\'retry\')" /></div>'
})

const stubs = {
  Button: buttonStub,
  Input: true,
  Label: true,
  Switch: true,
  Icon: true,
  InlineOperationFeedback: inlineFeedbackStub,
  Collapsible: passthrough('Collapsible'),
  CollapsibleContent: passthrough('CollapsibleContent'),
  Dialog: passthrough('Dialog'),
  DialogContent: passthrough('DialogContent'),
  DialogHeader: passthrough('DialogHeader'),
  DialogTitle: passthrough('DialogTitle'),
  DialogFooter: passthrough('DialogFooter'),
  DialogDescription: passthrough('DialogDescription'),
  Tooltip: passthrough('Tooltip'),
  TooltipContent: passthrough('TooltipContent'),
  TooltipProvider: passthrough('TooltipProvider'),
  TooltipTrigger: passthrough('TooltipTrigger')
}

type Case = {
  component: string
  load: () => Promise<{ default: any }>
  serverName: string
  listKey: string
  editingKey: string
  dialogKey: string
  saveMethod: string
  config: Record<string, unknown>
}

const cases: Case[] = [
  {
    component: 'RagflowKnowledgeSettings',
    load: () => import('../../../src/renderer/settings/components/RagflowKnowledgeSettings.vue'),
    serverName: 'ragflowKnowledge',
    listKey: 'ragflowConfigs',
    editingKey: 'editingRagflowConfig',
    dialogKey: 'isRagflowConfigDialogOpen',
    saveMethod: 'saveRagflowConfig',
    config: {
      description: 'RAGFlow docs',
      apiKey: 'ragflow-key',
      datasetIdsStr: 'docs, api',
      endpoint: 'http://ragflow.local',
      enabled: true
    }
  },
  {
    component: 'FastGptKnowledgeSettings',
    load: () => import('../../../src/renderer/settings/components/FastGptKnowledgeSettings.vue'),
    serverName: 'fastGptKnowledge',
    listKey: 'fastGptConfigs',
    editingKey: 'editingFastGptConfig',
    dialogKey: 'isFastGptConfigDialogOpen',
    saveMethod: 'saveFastGptConfig',
    config: {
      description: 'FastGPT docs',
      apiKey: 'fastgpt-key',
      datasetId: 'docs',
      endpoint: 'http://fastgpt.local/api',
      enabled: true
    }
  },
  {
    component: 'DifyKnowledgeSettings',
    load: () => import('../../../src/renderer/settings/components/DifyKnowledgeSettings.vue'),
    serverName: 'difyKnowledge',
    listKey: 'difyConfigs',
    editingKey: 'editingDifyConfig',
    dialogKey: 'isDifyConfigDialogOpen',
    saveMethod: 'saveDifyConfig',
    config: {
      description: 'Dify docs',
      apiKey: 'dify-key',
      datasetId: 'docs',
      endpoint: 'https://dify.local/v1',
      enabled: true
    }
  }
]

async function setup(testCase: Case) {
  vi.resetModules()

  const updateServer = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const toggleServer = vi.fn().mockResolvedValue(true)
  const mcpStore = reactive({
    mcpEnabled: true,
    config: {
      ready: true,
      mcpServers: {
        [testCase.serverName]: {
          enabled: true,
          env: { configs: [] }
        }
      }
    },
    serverStatuses: {
      [testCase.serverName]: true
    },
    updateServer,
    toggleServer
  })
  const feedbackSnapshot = ref<any>({ status: 'idle', version: 0 })
  const feedbackController = {
    begin: vi.fn((operationId: string, label: string) => {
      feedbackSnapshot.value = { status: 'pending', operationId, label, version: 1 }
    }),
    succeed: vi.fn((result) => {
      feedbackSnapshot.value = {
        status: 'success',
        operationId: 'knowledge-operation',
        ...result,
        version: 2
      }
    }),
    fail: vi.fn((result) => {
      feedbackSnapshot.value = {
        status: 'error',
        operationId: 'knowledge-operation',
        ...result,
        version: 2
      }
    }),
    clearSettled: vi.fn(() => {
      feedbackSnapshot.value = { status: 'idle', version: 3 }
    })
  }

  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@renderer-notifications/rendererNotificationRuntime', () => ({
    createRendererSurfaceFeedbackController: () => feedbackController
  }))
  vi.doMock('@renderer-notifications/useSurfaceFeedback', () => ({
    useSurfaceFeedback: () => ({
      snapshot: feedbackSnapshot,
      setActive: vi.fn()
    })
  }))
  vi.doMock('vue-router', () => ({
    useRoute: () => reactive({ query: {} })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const Component = (await testCase.load()).default
  const wrapper = mount(Component, {
    global: {
      mocks: {
        $t: (key: string) => key
      },
      stubs
    }
  })
  await flushPromises()

  return { wrapper, mcpStore, updateServer, toggleServer, feedbackController }
}

describe('external knowledge settings feedback', () => {
  it.each(cases)(
    '$component keeps local state unchanged until persistence succeeds',
    async (testCase) => {
      const { wrapper, updateServer, feedbackController } = await setup(testCase)
      const vm = wrapper.vm as any

      vm.openAddConfig()
      vm[testCase.editingKey] = { ...testCase.config }
      await vm[testCase.saveMethod]()
      await flushPromises()

      expect(updateServer).toHaveBeenCalledTimes(1)
      expect(vm[testCase.listKey]).toEqual([])
      expect(vm[testCase.dialogKey]).toBe(true)
      expect(feedbackController.fail).toHaveBeenCalledWith({
        code: expect.stringMatching(/\.save\.failed$/),
        title: 'common.error.operationFailed'
      })

      await wrapper.get('[data-testid="knowledge-operation-retry"]').trigger('click')
      await flushPromises()

      expect(updateServer).toHaveBeenCalledTimes(2)
      expect(vm[testCase.listKey]).toHaveLength(1)
      expect(vm[testCase.dialogKey]).toBe(false)
      expect(feedbackController.succeed).toHaveBeenCalledWith({
        code: expect.stringMatching(/\.save\.succeeded$/),
        title: 'common.saved'
      })
      wrapper.unmount()
    }
  )

  it.each(cases)(
    '$component preserves its configured server preference when global MCP is disabled',
    async (testCase) => {
      const { wrapper, mcpStore, toggleServer } = await setup(testCase)

      mcpStore.mcpEnabled = false
      await flushPromises()

      expect(toggleServer).not.toHaveBeenCalled()
      expect(mcpStore.config.mcpServers[testCase.serverName].enabled).toBe(true)
      wrapper.unmount()
    }
  )
})
