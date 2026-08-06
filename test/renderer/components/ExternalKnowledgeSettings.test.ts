import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const notifyRenderer = vi.hoisted(() => vi.fn())

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

const stubs = {
  DcButton: buttonStub,
  Input: true,
  Label: true,
  Switch: true,
  Icon: true,
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

  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
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

  return { wrapper, mcpStore, updateServer, toggleServer, notifyRenderer }
}

describe('external knowledge settings feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(cases)(
    '$component keeps local state unchanged until persistence succeeds',
    async (testCase) => {
      const { wrapper, updateServer, notifyRenderer } = await setup(testCase)
      const vm = wrapper.vm as any

      vm.openAddConfig()
      vm[testCase.editingKey] = { ...testCase.config }
      await vm[testCase.saveMethod]()
      await flushPromises()

      expect(updateServer).toHaveBeenCalledTimes(1)
      expect(vm[testCase.listKey]).toEqual([])
      expect(vm[testCase.dialogKey]).toBe(true)
      // 失败走按钮 ⚠ + 内联错误，不弹 toast
      expect(notifyRenderer).not.toHaveBeenCalled()
      expect(vm.knowledgeConfigs.operation.lastError.value).toEqual({
        title: 'common.error.operationFailed'
      })
      expect(wrapper.text()).toContain('common.error.operationFailed')

      ;(vm.knowledgeConfigs as any).operation.retry()
      await flushPromises()

      expect(updateServer).toHaveBeenCalledTimes(2)
      expect(vm[testCase.listKey]).toHaveLength(1)
      expect(vm[testCase.dialogKey]).toBe(false)
      // 成功走按钮 ✅，不弹 toast，内联错误清除
      expect(notifyRenderer).not.toHaveBeenCalled()
      expect(wrapper.text()).not.toContain('common.error.operationFailed')
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
