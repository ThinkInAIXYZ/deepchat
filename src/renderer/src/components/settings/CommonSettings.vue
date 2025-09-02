<template>
  <ScrollArea class="w-full h-full p-2">
    <div class="w-full h-full flex flex-col gap-1.5">
      <!-- 搜索引擎选择 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:search" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.searchEngine') }}</span>
        </span>
        <div class="flex-shrink-0 flex gap-2">
          <div class="min-w-52 max-w-96">
            <Select v-model="selectedSearchEngine" class="">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.common.searchEngineSelect')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="engine in settingsStore.searchEngines"
                  :key="engine.id"
                  :value="engine.id"
                >
                  {{ engine.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            :title="t('settings.common.addCustomSearchEngine')"
            @click="openAddSearchEngineDialog"
          >
            <Icon icon="lucide:plus" class="w-4 h-4" />
          </Button>
          <Button
            v-if="isCurrentEngineCustom"
            variant="outline"
            size="icon"
            :title="t('settings.common.deleteCustomSearchEngine')"
            @click="currentEngine && openDeleteSearchEngineDialog(currentEngine)"
          >
            <Icon icon="lucide:trash-2" class="w-4 h-4 text-destructive" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            :title="t('settings.common.testSearchEngine')"
            @click="openTestSearchEngineDialog"
          >
            <Icon icon="lucide:flask-conical" class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <!-- 网页内容长度限制 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:globe" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.webContentLengthLimit') }}</span>
          <div class="text-xs text-muted-foreground ml-1">
            {{ t('settings.common.webContentLengthLimitHint') }}
          </div>
        </span>
        <div class="flex-shrink-0 flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8 rounded-full"
            @click="decreaseWebContentLimit"
            :disabled="webContentLengthLimit <= 0"
          >
            <Icon icon="lucide:minus" class="h-3 w-3" />
          </Button>
          <div class="relative">
            <div
              v-if="!isEditingLimit"
              @click="startEditingLimit"
              class="min-w-16 h-8 flex items-center justify-center text-sm font-semibold cursor-pointer hover:bg-accent rounded px-2"
            >
              {{ webContentLengthLimit }}
            </div>
            <Input
              v-else
              ref="limitInputRef"
              type="number"
              :min="0"
              :max="10000"
              :model-value="webContentLengthLimit"
              @update:model-value="handleWebContentLengthLimitChange"
              @blur="stopEditingLimit"
              @keydown.enter="stopEditingLimit"
              @keydown.escape="stopEditingLimit"
              class="min-w-16 h-8 text-center text-sm font-semibold rounded px-2"
              :class="{ 'bg-accent': isEditingLimit }"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            class="h-8 w-8 rounded-full"
            @click="increaseWebContentLimit"
            :disabled="webContentLengthLimit >= 10000"
          >
            <Icon icon="lucide:plus" class="h-3 w-3" />
          </Button>
          <span class="text-xs text-muted-foreground ml-1">字符</span>
        </div>
      </div>

      <!-- 搜索助手模型选择 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:bot" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.searchAssistantModel') }}</span>
        </span>
        <div class="flex-shrink-0 min-w-64 max-w-96">
          <Popover v-model:open="modelSelectOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" class="w-full justify-between">
                <div class="flex items-center gap-2">
                  <ModelIcon
                    :model-id="selectedSearchModel?.id || ''"
                    class="h-4 w-4"
                    :is-dark="themeStore.isDark"
                  />
                  <span class="truncate">{{
                    selectedSearchModel?.name || t('settings.common.selectModel')
                  }}</span>
                </div>
                <ChevronDown class="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent class="w-80 p-0">
              <ModelSelect
                :type="[ModelType.Chat, ModelType.ImageGeneration]"
                @update:model="handleSearchModelSelect"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <!-- 代理模式选择 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:globe" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.proxyMode') }}</span>
        </span>
        <div class="flex-shrink-0 min-w-64 max-w-96">
          <Select v-model="selectedProxyMode" class="">
            <SelectTrigger>
              <SelectValue :placeholder="t('settings.common.proxyModeSelect')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mode in proxyModes" :key="mode.value" :value="mode.value">
                {{ mode.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div v-if="selectedProxyMode === 'custom'" class="flex flex-col p-2 gap-2 px-2">
        <div class="flex flex-row items-center gap-2">
          <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
            <Icon icon="lucide:link" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.common.customProxyUrl') }}</span>
          </span>
          <div class="flex-shrink-0 min-w-64 max-w-96">
            <Input
              v-model="customProxyUrl"
              :placeholder="t('settings.common.customProxyUrlPlaceholder')"
              :class="{ 'border-red-500': showUrlError }"
              @input="validateProxyUrl"
              @blur="validateProxyUrl"
            />
          </div>
        </div>
        <div v-if="showUrlError" class="text-xs text-red-500 ml-6">
          {{ t('settings.common.invalidProxyUrl') }}
        </div>
      </div>
      <!-- 搜索预览开关 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:eye" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.searchPreview') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Switch
            id="search-preview-switch"
            :checked="searchPreviewEnabled"
            @update:checked="handleSearchPreviewChange"
          />
        </div>
      </div>

      <!-- 日志开关 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:file-text" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.loggingEnabled') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Switch
            id="logging-switch"
            :checked="loggingEnabled"
            @update:checked="handleLoggingChange"
          />
        </div>
      </div>

      <!-- 音效开关 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:volume-2" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.soundEnabled') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Switch id="sound-switch" :checked="soundEnabled" @update:checked="handleSoundChange" />
        </div>
      </div>

      <!-- 复制全部（含COT）开关 -->
      <div class="flex flex-row p-2 items-center gap-2 px-2">
        <span class="flex flex-row items-center gap-2 flex-grow w-full" :dir="langStore.dir">
          <Icon icon="lucide:file-text" class="w-4 h-4 text-muted-foreground" />
          <span class="text-sm font-medium">{{ t('settings.common.copyWithCotEnabled') }}</span>
        </span>
        <div class="flex-shrink-0">
          <Switch
            id="copy-with-cot-switch"
            :checked="copyWithCotEnabled"
            @update:checked="handleCopyWithCotChange"
          />
        </div>
      </div>

      <!-- 日志开关确认对话框 -->
      <Dialog :open="isLoggingDialogOpen" @update:open="cancelLoggingChange">
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('settings.common.loggingDialogTitle') }}</DialogTitle>
            <DialogDescription>
              <div class="space-y-2">
                <p>
                  {{
                    newLoggingValue
                      ? t('settings.common.loggingEnableDesc')
                      : t('settings.common.loggingDisableDesc')
                  }}
                </p>
                <p>{{ t('settings.common.loggingRestartNotice') }}</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="cancelLoggingChange">{{ t('common.cancel') }}</Button>
            <Button @click="confirmLoggingChange">{{ t('common.confirm') }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div
        class="p-2 flex flex-row items-center gap-2 hover:bg-accent rounded-lg cursor-pointer"
        @click="openLogFolder"
        :dir="langStore.dir"
      >
        <Icon icon="lucide:external-link" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-medium">{{ t('settings.common.openLogFolder') }}</span>
      </div>
      <!-- 重置数据 -->
      <Dialog v-model:open="isDialogOpen">
        <DialogTrigger as-child>
          <div
            class="p-2 flex flex-row items-center gap-2 hover:bg-accent rounded-lg cursor-pointer"
            :dir="langStore.dir"
          >
            <Icon icon="lucide:trash" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.common.resetData') }}</span>
          </div>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('common.resetDataConfirmTitle') }}</DialogTitle>
            <DialogDescription>
              {{ t('common.resetDataConfirmDescription') }}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" @click="closeDialog">
              {{ t('dialog.cancel') }}
            </Button>
            <Button variant="destructive" @click="handleResetData">
              {{ t('dialog.confirm') }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </ScrollArea>

  <!-- 添加自定义搜索引擎对话框 -->
  <Dialog v-model:open="isAddSearchEngineDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('settings.common.addCustomSearchEngine') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.common.addCustomSearchEngineDesc') }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="search-engine-name" class="text-right">
            {{ t('settings.common.searchEngineName') }}
          </Label>
          <Input
            id="search-engine-name"
            v-model="newSearchEngine.name"
            class="col-span-3"
            :placeholder="t('settings.common.searchEngineNamePlaceholder')"
          />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="search-engine-url" class="text-right">
            {{ t('settings.common.searchEngineUrl') }}
          </Label>
          <div class="col-span-3">
            <Input
              id="search-engine-url"
              v-model="newSearchEngine.searchUrl"
              :placeholder="t('settings.common.searchEngineUrlPlaceholder')"
              :class="{ 'border-red-500': showSearchUrlError }"
            />
            <div v-if="showSearchUrlError" class="text-xs text-red-500 mt-1">
              {{ t('settings.common.searchEngineUrlError') }}
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="closeAddSearchEngineDialog">
          {{ t('dialog.cancel') }}
        </Button>
        <Button type="submit" :disabled="!isValidNewSearchEngine" @click="addCustomSearchEngine">
          {{ t('dialog.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 添加删除搜索引擎确认对话框 -->
  <Dialog v-model:open="isDeleteSearchEngineDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('settings.common.deleteCustomSearchEngine') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.common.deleteCustomSearchEngineDesc', { name: engineToDelete?.name }) }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="closeDeleteSearchEngineDialog">
          {{ t('dialog.cancel') }}
        </Button>
        <Button variant="destructive" @click="deleteCustomSearchEngine">
          {{ t('dialog.delete.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- 测试搜索引擎确认对话框 -->
  <Dialog v-model:open="isTestSearchEngineDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('settings.common.testSearchEngine') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.common.testSearchEngineDesc', { engine: currentEngine?.name || '' }) }}
          <div class="mt-2">
            {{ t('settings.common.testSearchEngineNote') }}
          </div>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="closeTestSearchEngineDialog">
          {{ t('dialog.cancel') }}
        </Button>
        <Button @click="testSearchEngine">
          {{ t('dialog.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { usePresenter } from '@/composables/usePresenter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronDown } from 'lucide-vue-next'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import type { SearchEngineTemplate } from '@shared/chat'
import { Switch } from '@/components/ui/switch'
import { nanoid } from 'nanoid'
import { useThemeStore } from '@/stores/theme'
import { useSoundStore } from '@/stores/sound'
import { useLanguageStore } from '@/stores/language'
import { ModelType } from '@shared/model'

const devicePresenter = usePresenter('devicePresenter')
const configPresenter = usePresenter('configPresenter')
const settingsStore = useSettingsStore()
const soundStore = useSoundStore()
const langStore = useLanguageStore()
const { t } = useI18n()
const themeStore = useThemeStore()
const selectedSearchEngine = ref(settingsStore.activeSearchEngine?.id ?? 'google')
const selectedSearchModel = computed(() => settingsStore.searchAssistantModel)

const selectedProxyMode = ref('system')
const customProxyUrl = ref('')
const showUrlError = ref(false)

// 网页内容长度限制
const webContentLengthLimit = ref(3000)
const isEditingLimit = ref(false)
const limitInputRef = ref<{ dom: HTMLInputElement }>()

// 新增搜索引擎相关
const isAddSearchEngineDialogOpen = ref(false)
const newSearchEngine = ref({
  name: '',
  searchUrl: ''
})
const showSearchUrlError = ref(false)

const isValidNewSearchEngine = computed(() => {
  return (
    newSearchEngine.value.name.trim() !== '' &&
    newSearchEngine.value.searchUrl.trim() !== '' &&
    newSearchEngine.value.searchUrl.includes('{query}')
  )
})

const openAddSearchEngineDialog = () => {
  newSearchEngine.value = {
    name: '',
    searchUrl: ''
  }
  showSearchUrlError.value = false
  isAddSearchEngineDialogOpen.value = true
}

const closeAddSearchEngineDialog = () => {
  isAddSearchEngineDialogOpen.value = false
}

const addCustomSearchEngine = async () => {
  if (!isValidNewSearchEngine.value) {
    if (!newSearchEngine.value.searchUrl.includes('{query}')) {
      showSearchUrlError.value = true
    }
    return
  }

  // 创建自定义搜索引擎对象
  const customEngine: SearchEngineTemplate = {
    id: `custom-${nanoid(6)}`,
    name: newSearchEngine.value.name.trim(),
    searchUrl: newSearchEngine.value.searchUrl.trim(),
    selector: '',
    extractorScript: '',
    isCustom: true
  }

  try {
    // 获取现有的自定义搜索引擎
    let customSearchEngines: SearchEngineTemplate[] = []
    try {
      customSearchEngines = (await configPresenter.getCustomSearchEngines()) || []
    } catch (error) {
      console.error('获取自定义搜索引擎失败:', error)
      customSearchEngines = []
    }

    // 添加新的自定义搜索引擎
    customSearchEngines.push(customEngine)

    // 保存自定义搜索引擎
    await configPresenter.setCustomSearchEngines(customSearchEngines)

    // 更新全局搜索引擎列表
    const allEngines = [
      ...settingsStore.searchEngines.filter((e) => !e.isCustom),
      ...customSearchEngines
    ]
    settingsStore.searchEngines.splice(0, settingsStore.searchEngines.length, ...allEngines)

    // 选择新添加的引擎
    selectedSearchEngine.value = customEngine.id
    await settingsStore.setSearchEngine(customEngine.id)

    closeAddSearchEngineDialog()
  } catch (error) {
    console.error('添加自定义搜索引擎失败:', error)
    // TODO: 显示错误提示
  }
}

let proxyUrlDebounceTimer: number | null = null

const proxyModes = [
  { value: 'system', label: t('settings.common.proxyModeSystem') },
  { value: 'none', label: t('settings.common.proxyModeNone') },
  { value: 'custom', label: t('settings.common.proxyModeCustom') }
]

const validateProxyUrl = () => {
  if (!customProxyUrl.value.trim()) {
    showUrlError.value = false
    return
  }

  const urlPattern =
    /^(http|https):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(:[0-9]+)?(\/[^\s]*)?$/

  const isValid = urlPattern.test(customProxyUrl.value)

  showUrlError.value = !isValid

  if (isValid || !customProxyUrl.value.trim()) {
    configPresenter.setCustomProxyUrl(customProxyUrl.value)
  }
}

onMounted(async () => {
  selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'

  selectedProxyMode.value = await configPresenter.getProxyMode()
  customProxyUrl.value = await configPresenter.getCustomProxyUrl()
  if (selectedProxyMode.value === 'custom' && customProxyUrl.value) {
    validateProxyUrl()
  }

  // 加载网页内容长度限制设置
  try {
    const savedLimit = await configPresenter.getSetting<number>('webContentLengthLimit')
    if (savedLimit !== undefined && savedLimit !== null) {
      webContentLengthLimit.value = savedLimit
    }
  } catch (error) {
    console.error('加载网页内容长度限制设置失败:', error)
  }
})

watch(selectedSearchEngine, async (newValue) => {
  await settingsStore.setSearchEngine(newValue)
})

watch(selectedProxyMode, (newValue) => {
  configPresenter.setProxyMode(newValue)
})

watch(customProxyUrl, () => {
  if (proxyUrlDebounceTimer !== null) {
    clearTimeout(proxyUrlDebounceTimer)
  }
  proxyUrlDebounceTimer = window.setTimeout(() => {
    validateProxyUrl()
  }, 300)
})

watch(
  () => isEditingLimit.value,
  async (newValue) => {
    if (newValue) {
      await nextTick()
      limitInputRef.value?.dom?.focus?.()
    }
  }
)

const isDialogOpen = ref(false)
const modelSelectOpen = ref(false)

const closeDialog = () => {
  isDialogOpen.value = false
}

const handleResetData = () => {
  devicePresenter.resetData()
  closeDialog()
}

const handleSearchModelSelect = (model: RENDERER_MODEL_META, providerId: string) => {
  console.log('update search model', model, providerId)
  settingsStore.setSearchAssistantModel(model, providerId)
  modelSelectOpen.value = false
}

const isDeleteSearchEngineDialogOpen = ref(false)
const engineToDelete = ref<SearchEngineTemplate | null>(null)

const openDeleteSearchEngineDialog = (engine: SearchEngineTemplate) => {
  engineToDelete.value = engine
  isDeleteSearchEngineDialogOpen.value = true
}

const closeDeleteSearchEngineDialog = () => {
  isDeleteSearchEngineDialogOpen.value = false
}

const deleteCustomSearchEngine = async () => {
  if (!engineToDelete.value) return

  try {
    // 获取现有的自定义搜索引擎
    let customSearchEngines: SearchEngineTemplate[] = []
    try {
      customSearchEngines = (await configPresenter.getCustomSearchEngines()) || []
    } catch (error) {
      console.error('获取自定义搜索引擎失败:', error)
      customSearchEngines = []
    }

    // 记录被删除的是否为当前选中的引擎
    const isDeletingActiveEngine = selectedSearchEngine.value === engineToDelete.value?.id

    // 过滤掉要删除的搜索引擎
    customSearchEngines = customSearchEngines.filter((e) => e.id !== engineToDelete.value?.id)

    // 保存自定义搜索引擎
    await configPresenter.setCustomSearchEngines(customSearchEngines)

    // 更新全局搜索引擎列表
    const allEngines = [
      ...settingsStore.searchEngines.filter((e) => !e.isCustom),
      ...customSearchEngines
    ]
    settingsStore.searchEngines.splice(0, settingsStore.searchEngines.length, ...allEngines)

    // 如果删除的是当前选中的引擎，则切换到第一个默认引擎
    if (isDeletingActiveEngine) {
      // 找到第一个默认引擎 (非自定义引擎)
      const firstDefaultEngine = settingsStore.searchEngines.find((e) => !e.isCustom)
      if (firstDefaultEngine) {
        selectedSearchEngine.value = firstDefaultEngine.id
        await settingsStore.setSearchEngine(firstDefaultEngine.id)
      }
    }

    closeDeleteSearchEngineDialog()
  } catch (error) {
    console.error('删除自定义搜索引擎失败:', error)
    // TODO: 显示错误提示
  }
}

// 获取当前选择的搜索引擎对象
const currentEngine = computed(() => {
  return (
    settingsStore.searchEngines.find((engine) => engine.id === selectedSearchEngine.value) || null
  )
})

// 判断当前选择的是否为自定义搜索引擎
const isCurrentEngineCustom = computed(() => {
  return currentEngine.value?.isCustom || false
})

// 搜索预览开关
const searchPreviewEnabled = computed({
  get: () => {
    return settingsStore.searchPreviewEnabled
  },
  set: (value) => {
    settingsStore.setSearchPreviewEnabled(value)
  }
})

// 日志开关
const loggingEnabled = computed({
  get: () => {
    return settingsStore.loggingEnabled
  },
  set: (value) => {
    settingsStore.setLoggingEnabled(value)
  }
})

// 处理搜索预览状态变更
const handleSearchPreviewChange = (value: boolean) => {
  console.log('切换搜索预览状态:', value)
  settingsStore.setSearchPreviewEnabled(value)
}

// 日志开关相关
const isLoggingDialogOpen = ref(false)
const newLoggingValue = ref(false)

// 处理日志开关状态变更
const handleLoggingChange = (value: boolean) => {
  console.log('准备切换日志状态:', value)
  // 显示确认对话框
  newLoggingValue.value = value
  isLoggingDialogOpen.value = true
}

// 处理网页内容长度限制变更
const handleWebContentLengthLimitChange = async (value: string | number) => {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value
  if (numValue >= 0 && numValue <= 10000 && !isNaN(numValue)) {
    try {
      const displayText = numValue === 0 ? '无限制' : `${numValue}字符`
      console.log('设置网页内容长度限制:', displayText)
      // 直接调用presenter设置，不依赖store
      await configPresenter.setSetting('webContentLengthLimit', numValue)
      // 更新响应式变量
      webContentLengthLimit.value = numValue
    } catch (error) {
      console.error('设置网页内容长度限制失败:', error)
    }
  }
}

// 增加网页内容长度限制
const increaseWebContentLimit = () => {
  const newValue = Math.min(webContentLengthLimit.value + 100, 20000)
  handleWebContentLengthLimitChange(newValue)
}

// 减少网页内容长度限制
const decreaseWebContentLimit = () => {
  const newValue = Math.max(webContentLengthLimit.value - 100, 0)
  handleWebContentLengthLimitChange(newValue)
}

// 开始编辑限制值
const startEditingLimit = () => {
  isEditingLimit.value = true
}

// 结束编辑限制值
const stopEditingLimit = () => {
  isEditingLimit.value = false
}

const cancelLoggingChange = () => {
  isLoggingDialogOpen.value = false
}

const confirmLoggingChange = () => {
  settingsStore.setLoggingEnabled(newLoggingValue.value)
  isLoggingDialogOpen.value = false
}

const openLogFolder = () => {
  configPresenter.openLoggingFolder()
}

// 音效开关相关
const soundEnabled = computed({
  get: () => {
    return soundStore.soundEnabled
  },
  set: (value) => {
    soundStore.setSoundEnabled(value)
  }
})

// 处理音效开关状态变更
const handleSoundChange = (value: boolean) => {
  soundStore.setSoundEnabled(value)
}

const copyWithCotEnabled = computed({
  get: () => {
    return settingsStore.copyWithCotEnabled
  },
  set: (value) => {
    settingsStore.setCopyWithCotEnabled(value)
  }
})

const handleCopyWithCotChange = (value: boolean) => {
  settingsStore.setCopyWithCotEnabled(value)
}

// 测试搜索引擎相关
const isTestSearchEngineDialogOpen = ref(false)

const openTestSearchEngineDialog = () => {
  isTestSearchEngineDialogOpen.value = true
}

const closeTestSearchEngineDialog = () => {
  isTestSearchEngineDialogOpen.value = false
}

const testSearchEngine = async () => {
  try {
    settingsStore.testSearchEngine('天气')
    closeTestSearchEngineDialog()
  } catch (error) {
    console.error('测试搜索引擎失败:', error)
  }
}
</script>

<style scoped>
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  /* display: none; <- Crashes Chrome on hover */
  -webkit-appearance: none;
  margin: 0;
  /* <-- Apparently some margin are still there even though it's hidden */
}

input[type='number'] {
  -moz-appearance: textfield;
  /* Firefox */
}
</style>
