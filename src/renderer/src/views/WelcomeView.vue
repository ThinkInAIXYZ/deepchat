<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, defineAsyncComponent } from 'vue'
import { Icon } from '@iconify/vue'
import logo from '@/assets/logo.png'
import { useSettingsStore } from '@/stores/settings'
import { usePresenter } from '@/composables/usePresenter'
import { useRouter } from 'vue-router'
import { MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'

const themeStore = useThemeStore()

const Button = defineAsyncComponent(() =>
  import('@/components/ui/button').then((mod) => mod.Button)
)
const Card = defineAsyncComponent(() => import('@/components/ui/card').then((mod) => mod.Card))
const CardHeader = defineAsyncComponent(() =>
  import('@/components/ui/card').then((mod) => mod.CardHeader)
)
const CardContent = defineAsyncComponent(() =>
  import('@/components/ui/card').then((mod) => mod.CardContent)
)
const CardFooter = defineAsyncComponent(() =>
  import('@/components/ui/card').then((mod) => mod.CardFooter)
)
const Label = defineAsyncComponent(() => import('@/components/ui/label').then((mod) => mod.Label))
const ModelIcon = defineAsyncComponent(() => import('@/components/icons/ModelIcon.vue'))
const Input = defineAsyncComponent(() => import('@/components/ui/input').then((mod) => mod.Input))
const Select = defineAsyncComponent(() =>
  import('@/components/ui/select').then((mod) => mod.Select)
)
const SelectContent = defineAsyncComponent(() =>
  import('@/components/ui/select').then((mod) => mod.SelectContent)
)
const SelectItem = defineAsyncComponent(() =>
  import('@/components/ui/select').then((mod) => mod.SelectItem)
)
const SelectTrigger = defineAsyncComponent(() =>
  import('@/components/ui/select').then((mod) => mod.SelectTrigger)
)
const SelectValue = defineAsyncComponent(() =>
  import('@/components/ui/select').then((mod) => mod.SelectValue)
)
const ModelConfigItem = defineAsyncComponent(
  () => import('@/components/settings/ModelConfigItem.vue')
)
const Dialog = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.Dialog)
)
const DialogContent = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.DialogContent)
)
const DialogHeader = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.DialogHeader)
)
const DialogTitle = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.DialogTitle)
)
const DialogDescription = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.DialogDescription)
)
const DialogFooter = defineAsyncComponent(() =>
  import('@/components/ui/dialog').then((mod) => mod.DialogFooter)
)
const ModelCheckDialog = defineAsyncComponent(
  () => import('@/components/settings/ModelCheckDialog.vue')
)

const settingsStore = useSettingsStore()
const languageStore = useLanguageStore()
const configPresenter = usePresenter('configPresenter')
const router = useRouter()

const { t } = useI18n()

type Step = {
  title: string
  description: string
  icon: string
  image?: string
}

const steps: Step[] = [
  {
    title: 'welcome.steps.welcome.title',
    description: 'welcome.steps.welcome.description',
    icon: 'lucide:sparkles',
    image: logo
  },
  {
    title: 'welcome.steps.provider.title',
    description: 'welcome.steps.provider.description',
    icon: 'lucide:user'
  },
  {
    title: 'welcome.steps.configuration.title',
    description: 'welcome.steps.configuration.description',
    icon: 'lucide:settings'
  },
  {
    title: 'welcome.steps.complete.title',
    description: 'welcome.steps.complete.description',
    icon: 'lucide:check-circle'
  }
]

const currentStep = ref(0)

const selectedProvider = ref<string>('openai')
const apiKey = ref('')
const baseUrl = ref('')
const showApiKey = ref(false)

const providerModels = computed(() => {
  return (
    settingsStore.allProviderModels.find((p) => p.providerId === selectedProvider.value)?.models ??
    []
  )
})

const providerModelLoading = ref(false)

const showErrorDialog = ref(false)
const showSuccessDialog = ref(false)
const dialogMessage = ref('')

// 模型检查弹窗状态
const showModelCheckDialog = ref(false)

const nextStep = async () => {
  if (currentStep.value < steps.length - 1) {
    if (currentStep.value === 1) {
      if ((!apiKey.value || !baseUrl.value) && selectedProvider.value !== 'ollama') {
        showErrorDialog.value = true
        dialogMessage.value = t('settings.provider.dialog.verify.missingFields')
        return
      }
      providerModelLoading.value = true
      await settingsStore.updateProvider(selectedProvider.value, {
        apiKey: apiKey.value,
        baseUrl: baseUrl.value,
        id: settingsStore.providers.find((p) => p.id === selectedProvider.value)!.id,
        name: settingsStore.providers.find((p) => p.id === selectedProvider.value)!.name,
        apiType: settingsStore.providers.find((p) => p.id === selectedProvider.value)!.apiType,
        enable: true
      })

      currentStep.value++
      setTimeout(() => {
        providerModelLoading.value = false
      }, 2000)
    } else {
      currentStep.value++
    }
  } else {
    configPresenter.setSetting('init_complete', true)
    if (!providerModels.value || providerModels.value.length === 0) {
      router.push({ name: 'settings' })
      return
    } else {
      router.push({
        name: 'chat',
        query: {
          modelId: providerModels.value[0].id,
          providerId: selectedProvider.value
        }
      })
    }
  }
}

const previousStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}
watch(
  () => selectedProvider.value,
  (newVal) => {
    // console.log('selectedProvider', newVal)
    const provider = settingsStore.providers.find((p) => p.id === newVal)
    if (provider) {
      baseUrl.value = provider.baseUrl
      apiKey.value = provider.apiKey
    }
  }
)

const cancelWatch = watch(
  () => settingsStore.providers,
  (newVal) => {
    if (newVal.length > 0) {
      console.log('newVal', newVal)
      selectedProvider.value = newVal[0].id
      baseUrl.value = newVal[0].baseUrl
      apiKey.value = newVal[0].apiKey
      nextTick(() => {
        cancelWatch()
      })
    }
  },
  { immediate: true }
)

onMounted(() => {
  settingsStore.initSettings()
  languageStore.initLanguage()
})

const handleModelEnabledChange = async (model: MODEL_META, enabled: boolean) => {
  try {
    await settingsStore.updateModelStatus(selectedProvider.value, model.id, enabled)
  } catch (error) {
    console.error('Failed to update model status:', error)
  }
  console.log('handleModelEnabledChange', model, enabled)
}

const openModelCheckDialog = () => {
  showModelCheckDialog.value = true
}

const isLastStep = computed(() => currentStep.value === steps.length - 1)
const isFirstStep = computed(() => currentStep.value === 0)
</script>

<template>
  <div class="h-full flex items-center justify-center bg-background p-4 w-full">
    <Card class="w-full max-w-2xl">
      <CardHeader>
        <div class="flex items-center space-x-4">
          <Icon :icon="steps[currentStep].icon" class="w-8 h-8 text-primary" />
          <div>
            <h2 class="text-2xl font-bold">{{ t(steps[currentStep].title) }}</h2>
            <p class="text-muted-foreground">
              {{ t(steps[currentStep].description) }}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <!-- Step Content -->
        <div class="min-h-[300px]">
          <template v-if="currentStep === 0">
            <div class="text-center space-y-4 pt-12">
              <img :src="steps[currentStep].image" class="w-16 h-16 mx-auto" />
              <h3 class="text-xl font-semibold">{{ t('welcome.title') }}</h3>
              <p class="text-muted-foreground">
                {{ t('welcome.description') }}
              </p>
            </div>
          </template>

          <template v-else-if="currentStep === 1">
            <div class="space-y-6 max-w-xs mx-auto">
              <div class="flex flex-col gap-2">
                <Label for="provider-select">{{ t('welcome.provider.select') }}</Label>
                <Select v-model="selectedProvider">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="provider in settingsStore.providers"
                      :key="provider.id"
                      :value="provider.id"
                    >
                      <div class="flex items-center space-x-2">
                        <ModelIcon
                          :model-id="provider.id"
                          :custom-class="'w-4 h-4 text-muted-foreground'"
                          :is-dark="themeStore.isDark"
                        />
                        <span>{{ provider.name }}</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <!-- Add API Configuration Section -->
              <div class="mt-6 space-y-4">
                <div class="flex flex-col gap-2">
                  <Label for="api-url">{{ t('welcome.provider.apiUrl') }}</Label>
                  <Input id="api-url" v-model="baseUrl" placeholder="Enter API URL" />
                  <div v-if="selectedProvider !== 'gemini'" class="text-xs text-muted-foreground">
                    {{ `${baseUrl ?? ''}/chat/completions` }}
                  </div>
                </div>

                <div v-show="selectedProvider !== 'ollama'" class="flex flex-col gap-2">
                  <Label for="api-key">{{ t('welcome.provider.apiKey') }}</Label>
                  <div class="relative w-full">
                    <Input
                      id="api-key"
                      v-model="apiKey"
                      :type="showApiKey ? 'text' : 'password'"
                      placeholder="Enter API Key"
                      style="padding-right: 2.5rem !important"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      class="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
                      @click="showApiKey = !showApiKey"
                    >
                      <Icon
                        :icon="showApiKey ? 'lucide:eye-off' : 'lucide:eye'"
                        class="w-4 h-4 text-muted-foreground hover:text-foreground"
                      />
                    </Button>
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {{ t('settings.provider.getKeyTip') }}
                    <a
                      :href="
                        settingsStore.providers.find((p) => p.id === selectedProvider)?.websites
                          ?.apiKey || '#'
                      "
                      target="_blank"
                      class="text-primary"
                    >
                      {{ settingsStore.providers.find((p) => p.id === selectedProvider)?.name }}
                    </a>
                    {{ t('settings.provider.getKeyTipEnd') }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else-if="currentStep === 2">
            <!-- Add Preferences Setup -->
            <div class="space-y-4">
              <!-- 模型检查按钮 -->
              <div
                v-show="!providerModelLoading && providerModels.length > 0"
                class="flex justify-center"
              >
                <Button
                  variant="outline"
                  size="sm"
                  class="rounded-lg"
                  @click="openModelCheckDialog"
                >
                  <Icon icon="lucide:check-check" class="w-4 h-4 mr-2 text-muted-foreground" />
                  {{ t('settings.provider.verifyKey') }}
                </Button>
              </div>

              <div
                v-show="!providerModelLoading"
                class="flex flex-col w-full border rounded-lg max-h-80 overflow-y-auto"
              >
                <ModelConfigItem
                  v-for="model in settingsStore.allProviderModels.find(
                    (p) => p.providerId === selectedProvider
                  )?.models"
                  :key="model.id"
                  :model-name="model.name"
                  :model-id="model.id"
                  :provider-id="selectedProvider"
                  :group="model.group"
                  :enabled="model.enabled ?? false"
                  :type="model.type ?? ModelType.Chat"
                  @enabled-change="handleModelEnabledChange(model, $event)"
                />
              </div>
              <div v-if="providerModelLoading">
                <div class="flex items-center justify-center">
                  <Icon icon="lucide:loader" class="w-4 h-4 animate-spin" />
                </div>
              </div>
              <div v-if="!providerModelLoading && providerModels.length <= 0">同步模型失败...</div>
              <!-- Add preferences components here -->
            </div>
          </template>

          <template v-else>
            <div class="text-center space-y-4">
              <Icon icon="lucide:party-popper" class="w-16 h-16 mx-auto text-primary" />
              <h3 class="text-xl font-semibold">{{ t('welcome.complete.title') }}</h3>
              <p class="text-muted-foreground">
                {{ t('welcome.complete.description') }}
              </p>
            </div>
          </template>
        </div>
      </CardContent>

      <CardFooter class="flex justify-between">
        <Button
          variant="outline"
          class="rounded-lg"
          size="sm"
          :class="{ 'opacity-0': isFirstStep }"
          @click="previousStep"
        >
          <Icon icon="lucide:arrow-left" class="w-4 h-4 mr-2" />
          {{ t('welcome.buttons.back') }}
        </Button>

        <Button class="rounded-lg" size="sm" @click="nextStep">
          <span>{{
            isLastStep ? t('welcome.buttons.getStarted') : t('welcome.buttons.next')
          }}</span>
          <Icon v-if="!isLastStep" icon="lucide:arrow-right" class="w-4 h-4 ml-2" />
        </Button>
      </CardFooter>
    </Card>
  </div>

  <Dialog v-model:open="showErrorDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.error.title') }}</DialogTitle>
        <DialogDescription>{{ dialogMessage }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button @click="showErrorDialog = false">{{ t('dialog.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="showSuccessDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('settings.provider.dialog.verify.success') }}</DialogTitle>
        <DialogDescription>{{ dialogMessage }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button @click="showSuccessDialog = false">{{ t('dialog.close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 模型检查弹窗 -->
  <ModelCheckDialog
    :open="showModelCheckDialog"
    :provider-id="selectedProvider"
    @update:open="showModelCheckDialog = $event"
  />
</template>
