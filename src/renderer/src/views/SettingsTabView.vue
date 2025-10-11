<template>
  <div class="w-full h-full flex flex-row bg-card mx-auto xl:max-w-6xl">
    <div class="w-52 h-full border-r border-border p-2 space-y-2 shrink-0 overflow-y-auto">
      <div
        v-for="setting in settings"
        :key="setting.name"
        :class="[
          'flex flex-row items-center hover:bg-accent gap-2 rounded-lg p-2 cursor-pointer',
          route.name === setting.name ? 'bg-secondary' : ''
        ]"
        @click="handleClick(setting.path)"
      >
        <Icon :icon="setting.icon" class="w-4 h-4 text-muted-foreground" />
        <span class="text-sm font-medium">{{ t(setting.title) }}</span>
      </div>
    </div>
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useRouter } from 'vue-router'
import { useRoute, RouterView } from 'vue-router'
import { onMounted, Ref, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTitle } from '@vueuse/core'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const title = useTitle()
const settings: Ref<
  {
    title: string
    name: string
    icon: string
    path: string
  }[]
> = ref([])

const routes = router.getRoutes()
onMounted(() => {
  routes.forEach((route) => {
    if (route.name === 'settings') {
      route.children?.forEach((child) => {
        settings.value.push({
          title: child.meta?.titleKey as string,
          icon: child.meta?.icon as string,
          path: `/settings/${child.path}`,
          name: child.name as string
        })
      })
    }
  })
})

// 更新标题的函数
const updateTitle = () => {
  const currentRoute = route.name as string
  const currentSetting = settings.value.find((s) => s.name === currentRoute)
  if (currentSetting) {
    // 使用i18n翻译标题，中文习惯是不需要破折号
    title.value = t('routes.settings') + ' - ' + t(currentSetting.title)
  } else {
    title.value = t('routes.settings')
  }
}

// 监听路由变化
watch(
  () => route.name,
  () => {
    updateTitle()
  },
  { immediate: true }
)

const handleClick = (path: string) => {
  router.push(path)
}
</script>

<style></style>
