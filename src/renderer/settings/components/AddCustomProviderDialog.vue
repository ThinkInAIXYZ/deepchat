<template>
  <Dialog v-model:open="isOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.addCustomProvider.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.provider.dialog.addCustomProvider.description') }}
        </DialogDescription>
      </DialogHeader>
      <DcForm
        class="grid gap-4 py-4"
        :validation-schema="validationSchema"
        @submit="handleSubmit"
        @error="handleSubmitError"
      >
        <FormField v-slot="{ componentField }" v-model="formData.name" name="name">
          <FormItem class="grid grid-cols-4 items-start gap-4">
            <FormLabel class="pt-2 text-right">
              {{ t('settings.provider.dialog.addCustomProvider.name') }}
            </FormLabel>
            <div class="col-span-3 grid gap-2">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="t('settings.provider.dialog.addCustomProvider.namePlaceholder')"
                />
              </FormControl>
              <FormMessage />
            </div>
          </FormItem>
        </FormField>
        <FormField v-slot="{ componentField }" v-model="formData.apiType" name="apiType">
          <FormItem class="grid grid-cols-4 items-start gap-4">
            <FormLabel class="pt-2 text-right">
              {{ t('settings.provider.dialog.addCustomProvider.apiType') }}
            </FormLabel>
            <div class="col-span-3 grid gap-2">
              <Select v-bind="componentField">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      :placeholder="
                        t('settings.provider.dialog.addCustomProvider.apiTypePlaceholder')
                      "
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="mistral">Mistral AI</SelectItem>
                  <!-- <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="cohere">Cohere</SelectItem>
                    <SelectItem value="zhinao">智脑</SelectItem>
                    <SelectItem value="custom">自定义</SelectItem> -->
                </SelectContent>
              </Select>
              <FormMessage />
            </div>
          </FormItem>
        </FormField>
        <FormField v-slot="{ componentField }" v-model="formData.apiKey" name="apiKey">
          <FormItem class="grid grid-cols-4 items-start gap-4">
            <FormLabel class="pt-2 text-right">
              {{ t('settings.provider.dialog.addCustomProvider.apiKey') }}
            </FormLabel>
            <div class="col-span-3 grid gap-2">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="t('settings.provider.dialog.addCustomProvider.apiKeyPlaceholder')"
                />
              </FormControl>
              <FormMessage />
            </div>
          </FormItem>
        </FormField>
        <FormField v-slot="{ componentField }" v-model="formData.baseUrl" name="baseUrl">
          <FormItem class="grid grid-cols-4 items-start gap-4">
            <FormLabel class="pt-2 text-right">
              {{ t('settings.provider.dialog.addCustomProvider.baseUrl') }}
            </FormLabel>
            <div class="col-span-3 grid gap-2">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="t('settings.provider.dialog.addCustomProvider.baseUrlPlaceholder')"
                />
              </FormControl>
              <div v-if="apiEndpointSuffix" class="text-xs text-muted-foreground">
                {{ `${formData.baseUrl ?? ''}${apiEndpointSuffix}` }}
              </div>
              <FormMessage />
            </div>
          </FormItem>
        </FormField>
        <FormField v-slot="{ componentField }" v-model="formData.enable" name="enable">
          <FormItem class="grid grid-cols-4 items-center gap-4">
            <FormLabel class="text-right">
              {{ t('settings.provider.dialog.addCustomProvider.enable') }}
            </FormLabel>
            <div class="col-span-3 flex items-center space-x-2">
              <FormControl>
                <Switch id="enable" v-bind="componentField" />
              </FormControl>
              <Label for="enable">
                {{ formData.enable ? t('common.enabled') : t('common.disabled') }}
              </Label>
            </div>
          </FormItem>
        </FormField>
        <DialogFooter>
          <DcFormActions
            :cancel-label="t('dialog.cancel')"
            :submit-label="t('dialog.confirm')"
            @cancel="closeDialog"
          />
        </DialogFooter>
      </DcForm>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@shadcn/components/ui/dialog'
import { DcForm } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@shadcn/components/ui/form'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { GenericValidateFunction } from 'vee-validate'
import { useProviderStore } from '@/stores/providerStore'

const { t } = useI18n()
const providerStore = useProviderStore()
const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const requiredRule: GenericValidateFunction = (value) =>
  hasText(value) || t('components.promptParamsDialog.required')
const apiKeyRule: GenericValidateFunction = (value, { form }) =>
  form.apiType === 'ollama' || hasText(value) || t('components.promptParamsDialog.required')
const validationSchema = {
  name: requiredRule,
  apiType: requiredRule,
  apiKey: apiKeyRule,
  baseUrl: requiredRule
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'provider-added', provider: LLM_PROVIDER): void
}>()

const isOpen = ref(props.open)
const apiEndpointSuffix = computed(() => {
  if (formData.value.apiType === 'openai') {
    return '/responses'
  }

  if (formData.value.apiType === 'openai-completions') {
    return '/chat/completions'
  }

  return ''
})

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

watch(
  () => formData.value.apiType,
  (newType, oldType) => {
    if (newType === 'ollama') {
      if (!formData.value.baseUrl) {
        formData.value.baseUrl = 'http://localhost:11434'
      }
      formData.value.apiKey = ''
    } else if (oldType === 'ollama' && formData.value.baseUrl === 'http://localhost:11434') {
      formData.value.baseUrl = ''
    }
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
  // 生成唯一ID
  formData.value.id = nanoid()
  await providerStore.addCustomProvider(formData.value)
  emit('provider-added', formData.value)
  closeDialog()
}

const handleSubmitError = (error: unknown) => {
  console.error('添加自定义提供商失败', error)
}
</script>
