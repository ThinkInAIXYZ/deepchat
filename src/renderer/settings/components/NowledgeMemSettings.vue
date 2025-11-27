<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      class="flex items-center p-4 hover:bg-accent cursor-default"
      @click="toggleNowledgeMemConfigPanel"
    >
      <div class="flex-1">
        <div class="flex items-center">
          <img src="@/assets/images/nowledge-mem.png" class="h-5 mr-2" />
          <span class="text-base font-medium">{{
            $t('settings.knowledgeBase.nowledgeMem.title')
          }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
          {{ $t('settings.knowledgeBase.nowledgeMem.description') }}
        </p>
      </div>
    </div>
    <div v-if="showConfigPanel" class="border-t p-4 space-y-4">
      <!-- Connection Test Section -->
      <div class="space-y-3">
        <div class="text-sm font-medium">
          {{ $t('settings.knowledgeBase.nowledgeMem.connection') }}
        </div>

        <div class="flex gap-2">
          <Button
            @click="testConnection"
            :disabled="testingConnection"
            variant="outline"
            size="sm"
            class="text-xs"
          >
            {{
              testingConnection
                ? $t('common.testing')
                : $t('settings.knowledgeBase.nowledgeMem.testConnection')
            }}
          </Button>
        </div>

        <div
          v-if="connectionResult"
          :class="[
            'p-3 rounded-md text-sm',
            connectionResult.success
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          ]"
        >
          {{ connectionResult.message || connectionResult.error }}
        </div>
      </div>

      <!-- Configuration Section -->
      <div class="space-y-3">
        <div class="text-sm font-medium">
          {{ $t('settings.knowledgeBase.nowledgeMem.configuration') }}
        </div>

        <!-- Base URL -->
        <div class="space-y-2">
          <Label for="baseUrl">
            {{ $t('settings.knowledgeBase.nowledgeMem.baseUrl') }}
          </Label>
          <Input
            id="baseUrl"
            v-model="config.baseUrl"
            type="url"
            placeholder="http://127.0.0.1:14242"
          />
        </div>

        <!-- API Key -->
        <div class="space-y-2">
          <Label for="apiKey">
            {{ $t('settings.knowledgeBase.nowledgeMem.apiKey') }}
          </Label>
          <div class="relative">
            <Input
              id="apiKey"
              v-model="config.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="Your API key (optional)"
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
          <p class="text-xs text-muted-foreground">
            {{ $t('settings.knowledgeBase.nowledgeMem.apiKeyHint') }}
          </p>
        </div>

        <!-- Timeout -->
        <div class="space-y-2">
          <Label for="timeout">
            {{ $t('settings.knowledgeBase.nowledgeMem.timeout') }}
          </Label>
          <div class="flex items-center gap-2">
            <Input
              id="timeout"
              v-model.number="timeoutSeconds"
              type="number"
              min="5"
              max="120"
              step="5"
              class="w-24"
            />
            <span class="text-sm text-muted-foreground">{{
              $t('settings.knowledgeBase.nowledgeMem.seconds')
            }}</span>
          </div>
        </div>

        <!-- Save Configuration Button -->
        <div class="flex gap-2">
          <Button
            @click="saveConfiguration"
            :disabled="savingConfig"
            variant="default"
            size="sm"
            class="text-xs"
          >
            {{
              savingConfig
                ? $t('common.saving')
                : $t('settings.knowledgeBase.nowledgeMem.saveConfig')
            }}
          </Button>

          <Button @click="resetConfiguration" variant="outline" size="sm" class="text-xs">
            {{ $t('settings.knowledgeBase.nowledgeMem.resetConfig') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Icon } from '@iconify/vue'

const chatStore = useChatStore()

const testingConnection = ref(false)
const savingConfig = ref(false)
const showApiKey = ref(false)
const showConfigPanel = ref(false)

const config = reactive({
  baseUrl: 'http://127.0.0.1:14242',
  apiKey: '',
  timeout: 30000
})

// Computed property for timeout in seconds for UI
const timeoutSeconds = computed({
  get: () => Math.round(config.timeout / 1000),
  set: (value: number) => {
    config.timeout = value * 1000
  }
})

const connectionResult = ref<{ success: boolean; message?: string; error?: string } | null>(null)

const toggleNowledgeMemConfigPanel = () => {
  showConfigPanel.value = !showConfigPanel.value
}

onMounted(async () => {
  await loadConfiguration()
})

const loadConfiguration = async () => {
  try {
    const savedConfig = chatStore.getNowledgeMemConfig()
    if (savedConfig) {
      Object.assign(config, savedConfig)
      // Convert milliseconds to seconds for UI
      if (savedConfig.timeout && !isNaN(savedConfig.timeout)) {
        config.timeout = savedConfig.timeout
      }
    }
  } catch (error) {
    console.error('Failed to load nowledge-mem config:', error)
  }
}

const testConnection = async () => {
  testingConnection.value = true
  connectionResult.value = null

  try {
    const result = await chatStore.testNowledgeMemConnection()
    connectionResult.value = result
  } catch (error) {
    connectionResult.value = {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed'
    }
  } finally {
    testingConnection.value = false
  }
}

const saveConfiguration = async () => {
  savingConfig.value = true

  try {
    await chatStore.updateNowledgeMemConfig({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeout: config.timeout
    })

    // Success feedback could be added here
  } catch (error) {
    console.error('Failed to save nowledge-mem config:', error)
  } finally {
    savingConfig.value = false
  }
}

const resetConfiguration = async () => {
  try {
    const defaultConfig = {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: '',
      timeout: 30000 // 30 seconds in milliseconds
    }

    await chatStore.updateNowledgeMemConfig(defaultConfig)

    Object.assign(config, defaultConfig)
  } catch (error) {
    console.error('Failed to reset nowledge-mem config:', error)
  }
}
</script>
