<template>
  <div class="flex flex-col gap-3 px-2 py-2 max-w-4xl">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span
        class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[200px]"
        :dir="languageStore.dir"
      >
        <Icon icon="lucide:type" class="w-4 h-4 text-muted-foreground" />
        <span class="truncate">{{ t('settings.display.fontTitle') }}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        class="h-9 md:h-8 px-3 w-full md:w-auto justify-center"
        :disabled="isResetting || (!uiSettingsStore.fontFamily && !uiSettingsStore.codeFontFamily)"
        @click="handleReset"
      >
        <Icon icon="lucide:rotate-ccw" class="h-4 w-4 mr-1.5" />
        {{ t('settings.display.fontReset') }}
      </Button>
    </div>

    <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
      <Spinner v-if="uiSettingsStore.isLoadingFonts" class="h-3 w-3" />
      <span>
        {{
          uiSettingsStore.isLoadingFonts
            ? t('settings.display.fontSystemLoading')
            : t('settings.display.fontUsageHint')
        }}
      </span>
    </div>

    <div class="flex flex-col gap-4">
      <div class="space-y-1.5">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground md:w-32 shrink-0">
            <span class="text-foreground font-medium text-sm">
              {{ t('settings.display.fontFamily') }}
            </span>
          </div>
          <div class="w-full md:w-[260px] ml-auto">
            <Popover v-model:open="textPopoverOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="w-full justify-between h-9"
                  :style="{ fontFamily: textPreviewFont }"
                >
                  <span class="truncate">{{ textFontLabel }}</span>
                  <Icon icon="lucide:chevrons-up-down" class="h-4 w-4 text-muted-foreground/70" />
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-[320px] p-0" align="start">
                <div class="p-2">
                  <div class="flex items-center gap-2 mb-2">
                    <Icon icon="lucide:search" class="h-4 w-4 text-muted-foreground" />
                    <Input
                      v-model="textQuery"
                      :placeholder="t('settings.display.fontSearchPlaceholder')"
                      class="h-8"
                    />
                  </div>
                  <ScrollArea class="h-64">
                    <div class="flex flex-col">
                      <button
                        type="button"
                        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left transition"
                        :class="{
                          'border border-primary/60 bg-primary/5': uiSettingsStore.fontFamily === ''
                        }"
                        @click="selectTextFont('')"
                      >
                        <span class="truncate">{{ defaultLabel }}</span>
                        <Icon
                          v-if="uiSettingsStore.fontFamily === ''"
                          icon="lucide:check"
                          class="h-4 w-4 text-primary"
                        />
                      </button>
                      <button
                        v-for="font in filteredTextFonts"
                        :key="'text-' + font"
                        type="button"
                        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left transition"
                        :class="{
                          'border border-primary/60 bg-primary/5':
                            uiSettingsStore.fontFamily === font
                        }"
                        :style="{ fontFamily: buildFontPreview(font, textPreviewFont) }"
                        @click="selectTextFont(font)"
                      >
                        <span class="truncate">{{ font }}</span>
                        <Icon
                          v-if="uiSettingsStore.fontFamily === font"
                          icon="lucide:check"
                          class="h-4 w-4 text-primary"
                        />
                      </button>
                      <p
                        v-if="!filteredTextFonts.length"
                        class="px-2 py-3 text-center text-xs text-muted-foreground"
                      >
                        {{ t('settings.display.fontSearchEmpty') }}
                      </p>
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <p
          class="text-[11px] text-muted-foreground leading-relaxed"
          :style="{ fontFamily: textPreviewFont }"
        >
          {{ t('settings.display.fontFamilyDesc') }}
        </p>
      </div>

      <div class="space-y-1.5">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground md:w-32 shrink-0">
            <span class="text-foreground font-medium text-sm">
              {{ t('settings.display.codeFontFamily') }}
            </span>
          </div>
          <div class="w-full md:w-[260px] ml-auto">
            <Popover v-model:open="codePopoverOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="w-full justify-between h-9"
                  :style="{ fontFamily: codePreviewFont }"
                >
                  <span class="truncate">{{ codeFontLabel }}</span>
                  <Icon icon="lucide:chevrons-up-down" class="h-4 w-4 text-muted-foreground/70" />
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-[320px] p-0" align="start">
                <div class="p-2">
                  <div class="flex items-center gap-2 mb-2">
                    <Icon icon="lucide:search" class="h-4 w-4 text-muted-foreground" />
                    <Input
                      v-model="codeQuery"
                      :placeholder="t('settings.display.fontSearchPlaceholder')"
                      class="h-8"
                    />
                  </div>
                  <ScrollArea class="h-64">
                    <div class="flex flex-col">
                      <button
                        type="button"
                        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left transition"
                        :class="{
                          'border border-primary/60 bg-primary/5':
                            uiSettingsStore.codeFontFamily === ''
                        }"
                        @click="selectCodeFont('')"
                      >
                        <span class="truncate">{{ defaultLabel }}</span>
                        <Icon
                          v-if="uiSettingsStore.codeFontFamily === ''"
                          icon="lucide:check"
                          class="h-4 w-4 text-primary"
                        />
                      </button>
                      <button
                        v-for="font in filteredCodeFonts"
                        :key="'code-' + font"
                        type="button"
                        class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left transition"
                        :class="{
                          'border border-primary/60 bg-primary/5':
                            uiSettingsStore.codeFontFamily === font
                        }"
                        :style="{ fontFamily: buildFontPreview(font, codePreviewFont) }"
                        @click="selectCodeFont(font)"
                      >
                        <span class="truncate">{{ font }}</span>
                        <Icon
                          v-if="uiSettingsStore.codeFontFamily === font"
                          icon="lucide:check"
                          class="h-4 w-4 text-primary"
                        />
                      </button>
                      <p
                        v-if="!filteredCodeFonts.length"
                        class="px-2 py-3 text-center text-xs text-muted-foreground"
                      >
                        {{ t('settings.display.fontSearchEmpty') }}
                      </p>
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <p
          class="text-[11px] text-muted-foreground leading-relaxed"
          :style="{ fontFamily: codePreviewFont }"
        >
          {{ t('settings.display.codeFontFamilyDesc') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Spinner } from '@shadcn/components/ui/spinner'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useLanguageStore } from '@/stores/language'

const { t } = useI18n()
const uiSettingsStore = useUiSettingsStore()
const languageStore = useLanguageStore()

const textPopoverOpen = ref(false)
const codePopoverOpen = ref(false)
const textQuery = ref('')
const codeQuery = ref('')
const isResetting = ref(false)

const fallbackFonts = [
  'Geist',
  'Inter',
  'SF Pro Text',
  'SF Pro Display',
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Segoe UI',
  'Roboto',
  'Noto Sans',
  'JetBrains Mono',
  'Fira Code',
  'Menlo',
  'Monaco',
  'Consolas',
  'Courier New'
]

const availableFonts = computed(() =>
  [...(uiSettingsStore.systemFonts.length > 0 ? uiSettingsStore.systemFonts : fallbackFonts)].sort(
    (a, b) => a.localeCompare(b)
  )
)

const filteredTextFonts = computed(() =>
  availableFonts.value.filter((font) =>
    font.toLowerCase().includes((textQuery.value || '').toLowerCase())
  )
)

const filteredCodeFonts = computed(() =>
  availableFonts.value.filter((font) =>
    font.toLowerCase().includes((codeQuery.value || '').toLowerCase())
  )
)

const defaultLabel = computed(() => t('settings.display.fontDefaultLabel'))
const textFontLabel = computed(() => uiSettingsStore.fontFamily || defaultLabel.value)
const codeFontLabel = computed(() => uiSettingsStore.codeFontFamily || defaultLabel.value)

const textPreviewFont = computed(() => uiSettingsStore.formattedFontFamily)
const codePreviewFont = computed(() => uiSettingsStore.formattedCodeFontFamily)

const buildFontPreview = (font: string, fallback: string) => {
  const normalized = (font || '').trim()
  if (!normalized) return fallback
  const wrapped =
    /\s/.test(normalized) && !normalized.includes(',') ? `"${normalized}"` : normalized
  return `${wrapped}, ${fallback}`
}

const selectTextFont = async (font: string) => {
  await uiSettingsStore.setFontFamily(font)
  textPopoverOpen.value = false
}

const selectCodeFont = async (font: string) => {
  await uiSettingsStore.setCodeFontFamily(font)
  codePopoverOpen.value = false
}

const handleReset = async () => {
  isResetting.value = true
  try {
    await uiSettingsStore.resetFontSettings()
  } finally {
    isResetting.value = false
  }
}

onMounted(() => {
  void uiSettingsStore.fetchSystemFonts()
})
</script>
