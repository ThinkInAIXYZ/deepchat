<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MCPServerConfig } from '@shared/presenter'

const { t } = useI18n()

const props = defineProps<{
  serverName?: string
  initialConfig?: MCPServerConfig
  editMode?: boolean
}>()

const emit = defineEmits<{
  submit: [serverName: string, config: MCPServerConfig]
}>()

// 表单状态
const name = ref(props.serverName || '')
const command = ref(props.initialConfig?.command || 'npx')
const args = ref(props.initialConfig?.args?.join(' ') || '')
const env = ref(JSON.stringify(props.initialConfig?.env || {}, null, 2))
const descriptions = ref(props.initialConfig?.descriptions || '')
const icons = ref(props.initialConfig?.icons || '📁')
const type = ref<'sse' | 'stdio'>(props.initialConfig?.type || 'stdio')
const baseUrl = ref(props.initialConfig?.baseUrl || '')

// 权限设置
const autoApproveAll = ref(props.initialConfig?.autoApprove?.includes('all') || false)
const autoApproveRead = ref(props.initialConfig?.autoApprove?.includes('read') || false)
const autoApproveWrite = ref(props.initialConfig?.autoApprove?.includes('write') || false)

// 当type变更时处理baseUrl的显示逻辑
const showBaseUrl = computed(() => type.value === 'sse')

// 当选择 all 时，自动选中其他权限
const handleAutoApproveAllChange = (checked: boolean) => {
  if (checked) {
    autoApproveRead.value = true
    autoApproveWrite.value = true
  }
}

// 验证
const isNameValid = computed(() => name.value.trim().length > 0)
const isCommandValid = computed(() => command.value.trim().length > 0)
const isArgsValid = computed(() => args.value.trim().length > 0)
const isEnvValid = computed(() => {
  try {
    JSON.parse(env.value)
    return true
  } catch (error) {
    return false
  }
})
const isBaseUrlValid = computed(() => {
  if (type.value !== 'sse') return true
  return baseUrl.value.trim().length > 0
})

const isFormValid = computed(
  () =>
    isNameValid.value &&
    isCommandValid.value &&
    isArgsValid.value &&
    isEnvValid.value &&
    isBaseUrlValid.value
)

// 提交表单
const handleSubmit = () => {
  if (!isFormValid.value) return

  // 处理自动授权设置
  const autoApprove: string[] = []
  if (autoApproveAll.value) {
    autoApprove.push('all')
  } else {
    if (autoApproveRead.value) autoApprove.push('read')
    if (autoApproveWrite.value) autoApprove.push('write')
  }

  const serverConfig: MCPServerConfig = {
    command: command.value.trim(),
    args: args.value.split(/\s+/).filter(Boolean),
    env: JSON.parse(env.value),
    descriptions: descriptions.value.trim(),
    icons: icons.value.trim(),
    autoApprove,
    type: type.value,
    ...(type.value === 'sse' ? { baseUrl: baseUrl.value.trim() } : {})
  }

  emit('submit', name.value.trim(), serverConfig)
}
</script>

<template>
  <form @submit.prevent="handleSubmit" class="space-y-4">
    <ScrollArea class="h-[500px]">
      <!-- 服务器名称 -->
      <div class="space-y-2">
        <Label for="server-name">{{ t('settings.mcp.serverForm.name') }}</Label>
        <Input
          id="server-name"
          v-model="name"
          :placeholder="t('settings.mcp.serverForm.namePlaceholder')"
          :disabled="editMode"
          required
        />
      </div>

      <!-- 服务器类型 -->
      <div class="space-y-2">
        <Label for="server-type">{{ t('settings.mcp.serverForm.type') }}</Label>
        <Select v-model="type">
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="t('settings.mcp.serverForm.typePlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stdio">{{ t('settings.mcp.serverForm.typeStdio') }}</SelectItem>
            <SelectItem value="sse">{{ t('settings.mcp.serverForm.typeSse') }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 基础URL，仅在类型为SSE时显示 -->
      <div class="space-y-2" v-if="showBaseUrl">
        <Label for="server-base-url">{{ t('settings.mcp.serverForm.baseUrl') }}</Label>
        <Input
          id="server-base-url"
          v-model="baseUrl"
          :placeholder="t('settings.mcp.serverForm.baseUrlPlaceholder')"
          required
        />
      </div>

      <!-- 命令 -->
      <div class="space-y-2">
        <Label for="server-command">{{ t('settings.mcp.serverForm.command') }}</Label>
        <Input
          id="server-command"
          v-model="command"
          :placeholder="t('settings.mcp.serverForm.commandPlaceholder')"
          required
        />
      </div>

      <!-- 参数 -->
      <div class="space-y-2">
        <Label for="server-args">{{ t('settings.mcp.serverForm.args') }}</Label>
        <Input
          id="server-args"
          v-model="args"
          :placeholder="t('settings.mcp.serverForm.argsPlaceholder')"
          required
        />
      </div>

      <!-- 环境变量 -->
      <div class="space-y-2">
        <Label for="server-env">{{ t('settings.mcp.serverForm.env') }}</Label>
        <Textarea
          id="server-env"
          v-model="env"
          rows="5"
          :placeholder="t('settings.mcp.serverForm.envPlaceholder')"
          :class="{ 'border-red-500': !isEnvValid }"
          required
        />
      </div>

      <!-- 描述 -->
      <div class="space-y-2">
        <Label for="server-description">{{ t('settings.mcp.serverForm.descriptions') }}</Label>
        <Input
          id="server-description"
          v-model="descriptions"
          :placeholder="t('settings.mcp.serverForm.descriptionsPlaceholder')"
        />
      </div>

      <!-- 图标 -->
      <div class="space-y-2">
        <Label for="server-icon">{{ t('settings.mcp.serverForm.icons') }}</Label>
        <Input
          id="server-icon"
          v-model="icons"
          :placeholder="t('settings.mcp.serverForm.iconsPlaceholder')"
        />
      </div>

      <!-- 自动授权选项 -->
      <div class="space-y-2">
        <Label>{{ t('settings.mcp.serverForm.autoApprove') }}</Label>
        <div class="flex flex-col space-y-2">
          <div class="flex items-center space-x-2">
            <Checkbox
              id="auto-approve-all"
              v-model:checked="autoApproveAll"
              @update:checked="handleAutoApproveAllChange"
            />
            <label
              for="auto-approve-all"
              class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {{ t('settings.mcp.serverForm.autoApproveAll') }}
            </label>
          </div>

          <div class="flex items-center space-x-2">
            <Checkbox id="auto-approve-read" v-model:checked="autoApproveRead" />
            <label
              for="auto-approve-read"
              class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {{ t('settings.mcp.serverForm.autoApproveRead') }}
            </label>
          </div>

          <div class="flex items-center space-x-2">
            <Checkbox id="auto-approve-write" v-model:checked="autoApproveWrite" />
            <label
              for="auto-approve-write"
              class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {{ t('settings.mcp.serverForm.autoApproveWrite') }}
            </label>
          </div>
        </div>
      </div>
    </ScrollArea>

    <!-- 提交按钮 -->
    <div class="flex justify-end pt-2">
      <Button type="submit" :disabled="!isFormValid">
        {{ t('settings.mcp.serverForm.submit') }}
      </Button>
    </div>
  </form>
</template>
