<template>
  <Dialog v-model:open="isOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.addCustomProvider.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.dialog.addCustomProvider.description') }}
        </DialogDescription>
      </DialogHeader>
      <form @submit.prevent="handleSubmit">
        <div class="grid gap-4 py-4">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="name" class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.name') }}
            </Label>
            <Input
              id="name"
              v-model="formData.name"
              class="col-span-3"
              :placeholder="t('settings.provider.dialog.addCustomProvider.namePlaceholder')"
              required
            />
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="apiType" class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.apiType') }}
            </Label>
            <Select v-model="formData.apiType" required>
              <SelectTrigger class="col-span-3">
                <SelectValue
                  :placeholder="t('settings.provider.dialog.addCustomProvider.apiTypePlaceholder')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <!-- <SelectItem value="ollama">Ollama</SelectItem>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="mistral">Mistral AI</SelectItem>
                <SelectItem value="cohere">Cohere</SelectItem>
                <SelectItem value="zhinao">智脑</SelectItem>
                <SelectItem value="custom">自定义</SelectItem> -->
              </SelectContent>
            </Select>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="apiKey" class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.apiKey') }}
            </Label>
            <Input
              id="apiKey"
              v-model="formData.apiKey"
              class="col-span-3"
              :placeholder="t('settings.provider.dialog.addCustomProvider.apiKeyPlaceholder')"
              required
            />
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="baseUrl" class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.baseUrl') }}
            </Label>
            <span class="col-span-3 flex flex-col">
              <Input
                id="baseUrl"
                v-model="formData.baseUrl"
                class="col-span-3"
                :placeholder="t('settings.provider.dialog.addCustomProvider.baseUrlPlaceholder')"
                required
              />
              <div v-if="formData.apiType === 'openai'" class="text-xs text-muted-foreground mt-1">
                {{ `${formData.baseUrl ?? ''}/chat/completions` }}
              </div>
            </span>
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="enable" class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.enable') }}
            </Label>
            <div class="flex items-center space-x-2 col-span-3">
              <Switch id="enable" v-model="formData.enable" />
              <Label for="enable">{{
                formData.enable ? t('common.enabled') : t('common.disabled')
              }}</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" @click="closeDialog">
            {{ t('dialog.cancel') }}
          </Button>
          <Button type="submit" :disabled="isSubmitting">
            {{ t('dialog.confirm') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { LLM_PROVIDER } from '@shared/presenter'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'provider-added', provider: LLM_PROVIDER): void
}>()

const isOpen = ref(props.open)
const isSubmitting = ref(false)

const formData = ref<LLM_PROVIDER>({
  id: '',
  name: '',
  apiType: 'openai', // 默认选择 OpenAI
  apiKey: '',
  baseUrl: '',
  enable: true
})

// 监听 open 属性变化
watch(
  () => props.open,
  (newVal) => {
    if (newVal && !isOpen.value) {
      formData.value = {
        id: '',
        name: '',
        apiType: 'openai',
        apiKey: '',
        baseUrl: '',
        enable: true
      }
    }
    isOpen.value = newVal
  }
)

// 监听 isOpen 变化，同步更新到父组件
watch(
  () => isOpen.value,
  (newVal) => {
    emit('update:open', newVal)
  }
)

const onOpenChange = (open: boolean) => {
  isOpen.value = open
  if (!open) {
    // 重置表单
    resetForm()
  }
}

const resetForm = () => {
  formData.value = {
    id: '',
    name: '',
    apiType: 'openai',
    apiKey: '',
    baseUrl: '',
    enable: true
  }
}

const closeDialog = () => {
  isOpen.value = false
}

const handleSubmit = async () => {
  try {
    isSubmitting.value = true

    // 生成唯一ID
    formData.value.id = nanoid()

    closeDialog()
    // 使用 settingsStore 添加新的提供商
    await settingsStore.addCustomProvider(formData.value)

    // 通知父组件添加成功
    emit('provider-added', formData.value)
  } catch (error) {
    console.error('添加自定义提供商失败', error)
  } finally {
    isSubmitting.value = false
    // 关闭弹窗
  }
}
</script>
