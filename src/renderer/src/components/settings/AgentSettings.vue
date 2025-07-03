<template>
  <div class="flex flex-col h-full p-6 bg-background">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-foreground mb-2">{{ t('settings.agent.title') }}</h1>
      <p class="text-muted-foreground">
        {{ t('settings.agent.description') }}
      </p>
    </div>

    <!-- 代理列表 -->
    <div class="flex-1 space-y-6">
      <!-- 添加新代理按钮 -->
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-semibold">{{ t('settings.agent.agentList') }}</h2>
        <Button @click="showAddAgentDialog = true" class="flex items-center gap-2">
          <Icon icon="lucide:plus" class="w-4 h-4" />
          {{ t('settings.agent.addAgent') }}
        </Button>
      </div>

      <!-- 代理卡片 -->
      <div v-if="agents.length === 0" class="text-center py-12 text-muted-foreground">
        {{ t('settings.agent.noAgents') }}
      </div>

      <div v-else class="grid gap-4">
        <Card v-for="agent in agents" :key="agent.id" class="p-6">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon icon="lucide:bot" class="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 class="font-semibold text-foreground">{{ agent.name }}</h3>
                <p class="text-sm text-muted-foreground">{{ agent.type.toUpperCase() }} Agent</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Badge :variant="agent.enabled ? 'default' : 'secondary'">
                {{ agent.enabled ? t('settings.agent.enabled') : t('settings.agent.disabled') }}
              </Badge>
              <Button variant="ghost" size="sm" @click="editAgent(agent)">
                <Icon icon="lucide:settings" class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" @click="deleteAgent(agent.id)"
                class="text-destructive hover:text-destructive">
                <Icon icon="lucide:trash-2" class="w-4 h-4" />
              </Button>
            </div>
          </div>

          <!-- 代理配置信息 -->
          <div class="space-y-2 text-sm">
            <div v-if="agent.config.baseUrl" class="flex justify-between">
              <span class="text-muted-foreground">{{ t('settings.agent.apiUrl') }}:</span>
              <span class="font-mono text-xs">{{ agent.config.baseUrl }}</span>
            </div>
            <div v-if="agent.config.agentId" class="flex justify-between">
              <span class="text-muted-foreground">{{ t('settings.agent.agentId') }}:</span>
              <span class="font-mono text-xs">{{ agent.config.agentId }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">{{ t('settings.agent.status') }}:</span>
              <span :class="checkingStatus[agent.id] ? 'text-yellow-600' :
                agentStatus[agent.id]?.isOk ? 'text-green-600' : 'text-red-600'">
                {{ checkingStatus[agent.id] ? t('settings.agent.checking') :
                  agentStatus[agent.id]?.isOk ? t('settings.agent.connected') :
                    agentStatus[agent.id]?.errorMsg || t('settings.agent.notTested') }}
              </span>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="flex justify-between items-center mt-4 pt-4 border-t">
            <div class="flex gap-2">
              <Button size="sm" variant="outline" @click="testAgent(agent.id)" :disabled="checkingStatus[agent.id]">
                <Icon icon="lucide:wifi" class="w-4 h-4 mr-1" />
                {{ t('settings.agent.testConnection') }}
              </Button>
            </div>
            <Switch :checked="agent.enabled" @update:checked="(checked) => toggleAgent(agent.id, checked)" />
          </div>
        </Card>
      </div>
    </div>

    <!-- 添加/编辑代理对话框 -->
    <Dialog v-model:open="showAddAgentDialog">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ editingAgent ? t('settings.agent.dialog.edit.title') : t('settings.agent.dialog.add.title') }}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4">
          <!-- 代理名称 -->
          <div class="space-y-2">
            <Label>{{ t('settings.agent.dialog.form.name') }}</Label>
            <Input v-model="agentForm.name" :placeholder="t('settings.agent.dialog.form.namePlaceholder')" />
          </div>

          <!-- 代理类型 -->
          <div class="space-y-2">
            <Label>{{ t('settings.agent.dialog.form.type') }}</Label>
            <Select v-model="agentForm.type">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.agent.dialog.form.typePlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="datlas">{{ t('settings.agent.types.datlas') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Datlas 特定配置 -->
          <div v-if="agentForm.type === 'datlas'" class="space-y-4">
            <div class="space-y-2">
              <Label>{{ t('settings.agent.dialog.form.apiUrl') }}</Label>
              <Input v-model="agentForm.config.baseUrl"
                :placeholder="t('settings.agent.dialog.form.apiUrlPlaceholder')" />
            </div>

            <div class="space-y-2">
              <Label>{{ t('settings.agent.dialog.form.agentId') }}</Label>
              <Input v-model="agentForm.config.agentId"
                :placeholder="t('settings.agent.dialog.form.agentIdPlaceholder')" />
            </div>

            <div class="space-y-2">
              <Label>{{ t('settings.agent.dialog.form.token') }}</Label>
              <Input v-model="agentForm.config.token" type="password"
                :placeholder="t('settings.agent.dialog.form.tokenPlaceholder')" />
            </div>


          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="cancelEdit">{{ t('settings.agent.dialog.cancel') }}</Button>
          <Button @click="saveAgent" :disabled="!canSave">
            {{ editingAgent ? t('settings.agent.dialog.save') : t('settings.agent.dialog.add') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { nanoid } from 'nanoid'

const { t } = useI18n()

// 代理配置类型
interface AgentConfig {
  id: string
  name: string
  type: string
  enabled: boolean
  config: { baseUrl: string; agentId: string; token: string; }
  custom?: boolean
}

// 状态管理
const agents = ref<AgentConfig[]>([])
const showAddAgentDialog = ref(false)
const editingAgent = ref<AgentConfig | null>(null)
const checkingStatus = ref<Record<string, boolean>>({})
const agentStatus = ref<Record<string, { isOk: boolean; errorMsg?: string }>>({})

// 表单数据
const agentForm = ref({
  name: '',
  type: 'datlas',
  config: {
    baseUrl: 'https://ai.maicedata.com/api/knowbase/rag',
    agentId: '',
    token: '',
  }
})

// 计算属性
const canSave = computed(() => {
  if (!agentForm.value.name.trim()) return false
  if (!agentForm.value.type) return false

  if (agentForm.value.type === 'datlas') {
    return agentForm.value.config.agentId.trim() && agentForm.value.config.token.trim()
  }

  return true
})

// 方法
const loadAgents = async () => {
  try {
    // TODO: 从configPresenter加载代理配置
    // agents.value = await configPresenter.getAgents()

    // 临时模拟数据
    agents.value = []
  } catch (error) {
    console.error('Failed to load agents:', error)
  }
}

const saveAgent = async () => {
  try {
    const agentData: AgentConfig = {
      id: editingAgent.value?.id || nanoid(),
      name: agentForm.value.name.trim(),
      type: agentForm.value.type,
      enabled: editingAgent.value?.enabled ?? true,
      config: { ...agentForm.value.config },
      custom: true
    }

    if (editingAgent.value) {
      // 更新现有代理
      const index = agents.value.findIndex(a => a.id === editingAgent.value!.id)
      if (index !== -1) {
        agents.value[index] = agentData
      }
    } else {
      // 添加新代理
      agents.value.push(agentData)
    }

    // TODO: 保存到configPresenter
    // await configPresenter.setAgents(agents.value)

    cancelEdit()
  } catch (error) {
    console.error('Failed to save agent:', error)
  }
}

const editAgent = (agent: AgentConfig) => {
  editingAgent.value = agent
  agentForm.value = {
    name: agent.name,
    type: agent.type,
    config: { ...agent.config }
  }
  showAddAgentDialog.value = true
}

const deleteAgent = async (agentId: string) => {
  try {
    agents.value = agents.value.filter(a => a.id !== agentId)

    // TODO: 保存到configPresenter
    // await configPresenter.setAgents(agents.value)
  } catch (error) {
    console.error('Failed to delete agent:', error)
  }
}

const toggleAgent = async (agentId: string, enabled: boolean) => {
  try {
    const agent = agents.value.find(a => a.id === agentId)
    if (agent) {
      agent.enabled = enabled

      // TODO: 保存到configPresenter
      // await configPresenter.setAgents(agents.value)
    }
  } catch (error) {
    console.error('Failed to toggle agent:', error)
  }
}

const testAgent = async (agentId: string) => {
  try {
    checkingStatus.value[agentId] = true

    // TODO: 调用agentFlowPresenter.check
    // const result = await agentFlowPresenter.check(agentId)
    // agentStatus.value[agentId] = result

    // 临时模拟
    await new Promise(resolve => setTimeout(resolve, 1000))
    agentStatus.value[agentId] = { isOk: true }

  } catch (error) {
    agentStatus.value[agentId] = {
      isOk: false,
      errorMsg: error instanceof Error ? error.message : '连接失败'
    }
  } finally {
    checkingStatus.value[agentId] = false
  }
}

const cancelEdit = () => {
  showAddAgentDialog.value = false
  editingAgent.value = null
  agentForm.value = {
    name: '',
    type: 'datlas',
    config: {
      baseUrl: 'https://ai.maicedata.com/api/knowbase/rag',
      agentId: '',
      token: ''
    }
  }
}

// 生命周期
onMounted(() => {
  loadAgents()
})
</script>
