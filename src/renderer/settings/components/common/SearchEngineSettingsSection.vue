<template>
  <section>
    <div class="flex items-center gap-3 h-10">
      <span
        class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
        :dir="langStore.dir"
      >
        <Icon icon="lucide:search" class="w-4 h-4 text-muted-foreground" />
        <span class="truncate">{{ t('settings.common.searchEngine') }}</span>
      </span>
      <div class="flex items-center gap-2 ml-auto flex-wrap justify-end">
        <div class="w-auto">
          <Select v-model="selectedSearchEngine">
            <SelectTrigger class="px-3 h-8! text-sm border-border hover:bg-accent">
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
          size="icon-sm"
          class="w-8 h-8"
          :title="t('settings.common.addCustomSearchEngine')"
          @click="openAddSearchEngineDialog"
        >
          <Icon icon="lucide:plus" class="w-4 h-4" />
        </Button>
        <Button
          v-if="isCurrentEngineCustom"
          variant="outline"
          size="icon-sm"
          class="w-7 h-7"
          :title="t('settings.common.deleteCustomSearchEngine')"
          @click="currentEngine && openDeleteSearchEngineDialog(currentEngine)"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4 text-destructive" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="w-8 h-8"
          :title="t('settings.common.testSearchEngine')"
          @click="openTestSearchEngineDialog"
        >
          <Icon icon="lucide:flask-conical" class="w-4 h-4" />
        </Button>
      </div>
    </div>

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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { useSettingsStore } from '@/stores/settings'
import { useLanguageStore } from '@/stores/language'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import type { SearchEngineTemplate } from '@shared/chat'
import { nanoid } from 'nanoid'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const settingsStore = useSettingsStore()
const langStore = useLanguageStore()

const selectedSearchEngine = ref(settingsStore.activeSearchEngine?.id ?? 'google')

const isAddSearchEngineDialogOpen = ref(false)
const newSearchEngine = ref({
  name: '',
  searchUrl: ''
})
const showSearchUrlError = ref(false)

const isDeleteSearchEngineDialogOpen = ref(false)
const engineToDelete = ref<SearchEngineTemplate | null>(null)

const isTestSearchEngineDialogOpen = ref(false)

const isValidNewSearchEngine = computed(() => {
  return (
    newSearchEngine.value.name.trim() !== '' &&
    newSearchEngine.value.searchUrl.trim() !== '' &&
    newSearchEngine.value.searchUrl.includes('{query}')
  )
})

const currentEngine = computed(() => {
  return (
    settingsStore.searchEngines.find((engine) => engine.id === selectedSearchEngine.value) || null
  )
})

const isCurrentEngineCustom = computed(() => currentEngine.value?.isCustom || false)

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

  const customEngine: SearchEngineTemplate = {
    id: `custom-${nanoid(6)}`,
    name: newSearchEngine.value.name.trim(),
    searchUrl: newSearchEngine.value.searchUrl.trim(),
    selector: '',
    extractorScript: '',
    isCustom: true
  }

  try {
    let customSearchEngines: SearchEngineTemplate[] = []
    try {
      customSearchEngines = (await configPresenter.getCustomSearchEngines()) || []
    } catch (error) {
      console.error('获取自定义搜索引擎失败:', error)
      customSearchEngines = []
    }

    customSearchEngines.push(customEngine)

    await configPresenter.setCustomSearchEngines(customSearchEngines)

    const allEngines = [
      ...settingsStore.searchEngines.filter((e) => !e.isCustom),
      ...customSearchEngines
    ]
    settingsStore.searchEngines.splice(0, settingsStore.searchEngines.length, ...allEngines)

    selectedSearchEngine.value = customEngine.id
    await settingsStore.setSearchEngine(customEngine.id)

    closeAddSearchEngineDialog()
  } catch (error) {
    console.error('添加自定义搜索引擎失败:', error)
  }
}

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
    let customSearchEngines: SearchEngineTemplate[] = []
    try {
      customSearchEngines = (await configPresenter.getCustomSearchEngines()) || []
    } catch (error) {
      console.error('获取自定义搜索引擎失败:', error)
      customSearchEngines = []
    }

    const isDeletingActiveEngine = selectedSearchEngine.value === engineToDelete.value?.id

    customSearchEngines = customSearchEngines.filter((e) => e.id !== engineToDelete.value?.id)

    await configPresenter.setCustomSearchEngines(customSearchEngines)

    const allEngines = [
      ...settingsStore.searchEngines.filter((e) => !e.isCustom),
      ...customSearchEngines
    ]
    settingsStore.searchEngines.splice(0, settingsStore.searchEngines.length, ...allEngines)

    if (isDeletingActiveEngine) {
      const firstDefaultEngine = settingsStore.searchEngines.find((e) => !e.isCustom)
      if (firstDefaultEngine) {
        selectedSearchEngine.value = firstDefaultEngine.id
        await settingsStore.setSearchEngine(firstDefaultEngine.id)
      }
    }

    closeDeleteSearchEngineDialog()
  } catch (error) {
    console.error('删除自定义搜索引擎失败:', error)
  }
}

const openTestSearchEngineDialog = () => {
  isTestSearchEngineDialogOpen.value = true
}

const closeTestSearchEngineDialog = () => {
  isTestSearchEngineDialogOpen.value = false
}

const testSearchEngine = async () => {
  try {
    await settingsStore.testSearchEngine('天气')
    closeTestSearchEngineDialog()
  } catch (error) {
    console.error('测试搜索引擎失败:', error)
  }
}

watch(selectedSearchEngine, async (newValue) => {
  await settingsStore.setSearchEngine(newValue)
})

watch(
  () => settingsStore.activeSearchEngine?.id,
  (newValue) => {
    if (newValue && newValue !== selectedSearchEngine.value) {
      selectedSearchEngine.value = newValue
    }
  }
)

onMounted(async () => {
  selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'
})
</script>
