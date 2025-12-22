<template>
  <section class="px-0">
    <button
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/40"
      type="button"
      @click="showTabs = !showTabs"
    >
      <Icon icon="lucide:compass" class="h-3.5 w-3.5" />
      <span
        class="flex-1 text-[12px] font-medium tracking-wide text-foreground/80 dark:text-white/80"
      >
        {{ t('chat.workspace.browser.section') }}
      </span>
      <span class="text-[10px] text-muted-foreground">
        {{ tabCount }}
      </span>
      <Icon
        :icon="showTabs ? 'lucide:chevron-down' : 'lucide:chevron-up'"
        class="h-3 w-3 text-muted-foreground"
      />
    </button>

    <Transition name="workspace-collapse">
      <div v-if="showTabs" class="space-y-0 overflow-hidden">
        <div v-if="store.tabs.length === 0" class="px-4 py-3 text-[11px] text-muted-foreground">
          {{ t('chat.workspace.browser.empty') }}
        </div>
        <ul v-else class="pb-1">
          <li v-for="tab in store.tabs" :key="tab.id">
            <button
              class="flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition hover:bg-muted/40"
              :class="tab.isActive ? 'bg-muted/40 text-foreground' : 'text-muted-foreground'"
              type="button"
              @click="openTab(tab.id)"
            >
              <span class="flex h-4 w-4 items-center justify-center">
                <img v-if="tab.favicon" :src="tab.favicon" alt="" class="h-3.5 w-3.5" />
                <Icon v-else icon="lucide:form" class="h-3.5 w-3.5" />
              </span>
              <span class="flex-1 truncate text-[12px] font-medium">
                {{ tab.title || tab.url || 'about:blank' }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useYoBrowserStore } from '@/stores/yoBrowser'

const { t } = useI18n()
const store = useYoBrowserStore()
const showTabs = ref(true)

const tabCount = computed(() => store.tabs.length)

const openTab = async (tabId: string) => {
  await store.openTab(tabId)
}
</script>

<style scoped>
.workspace-collapse-enter-active,
.workspace-collapse-leave-active {
  transition: all 0.18s ease;
}

.workspace-collapse-enter-from,
.workspace-collapse-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}

.workspace-collapse-enter-to,
.workspace-collapse-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 300px;
}
</style>
