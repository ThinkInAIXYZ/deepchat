<template>
  <div class="container mx-auto p-4">
    <div class="flex flex-col items-center justify-center gap-6">
      <!-- 用户头像 -->
      <div class="relative w-24 h-24 rounded-full overflow-hidden border-4 border-primary">
        <img
          v-if="userStore.avatarUrl && !avatarError"
          :src="safeAvatarUrl"
          alt="用户头像"
          class="w-full h-full object-cover"
          @error="avatarError = true"
        />
        <div v-else class="w-full h-full bg-muted flex items-center justify-center">
          <Icon icon="lucide:user" class="w-12 h-12 text-muted-foreground" />
        </div>
      </div>

      <!-- 用户信息 -->
      <div class="text-center">
        <h1 class="text-2xl font-bold">{{ userStore.nickname || userStore.username }}</h1>
        <p v-if="userStore.nickname && userStore.username" class="text-sm text-muted-foreground">
          @{{ userStore.username }}
        </p>
        <p class="text-sm text-muted-foreground mt-1">
          注册时间: {{ formatDate(userStore.userInfo?.createdAt) }}
        </p>
        <p class="text-sm text-muted-foreground">
          上次登录: {{ formatDate(userStore.userInfo?.lastLoginAt) }}
        </p>
      </div>

      <!-- 其他用户信息卡片 -->
      <div class="w-full max-w-md p-4 border rounded-lg shadow-sm bg-card">
        <h2 class="text-lg font-medium mb-4">账号信息</h2>
        
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">邮箱</span>
            <span>{{ userStore.userInfo?.email || '未设置' }}</span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">手机</span>
            <span>{{ formatPhone(userStore.userInfo?.phone) || '未设置' }}</span>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">账号状态</span>
            <Badge variant="outline" :class="getStatusClass(userStore.userInfo?.status)">
              {{ getStatusText(userStore.userInfo?.status) }}
            </Badge>
          </div>
          
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">登录方式</span>
            <div class="flex gap-2">
              <Icon
                v-for="provider in userStore.userInfo?.authProviders"
                :key="provider.providerName"
                :icon="getProviderIcon(provider.providerName)"
                class="w-5 h-5"
                :title="provider.providerDisplay"
              />
              <span v-if="!userStore.userInfo?.authProviders?.length">尚未绑定</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-4">
        <!-- 其他可能的操作按钮 -->
        <Button variant="outline">
          <Icon icon="lucide:edit" class="mr-2 h-4 w-4" />
          编辑资料
        </Button>
        
        <!-- 退出登录按钮 -->
        <Button variant="destructive" @click="handleLogout">
          <Icon icon="lucide:log-out" class="mr-2 h-4 w-4" />
          退出登录
        </Button>
      </div>
      
      <!-- 修复登录状态按钮 (仅在状态不一致时显示) -->
      <Button
        v-if="userStore.isLoggedIn !== authStore.isAuthenticated"
        variant="destructive"
        size="sm"
        class="mb-2 text-xs"
        @click="handleForceLogout"
      >
        <Icon icon="lucide:trash-2" class="mr-1 h-3 w-3" />
        修复登录状态
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUserStore } from '@/stores/user'
import { useAuthStore } from '@/stores/auth'
import { usePresenter } from '@/composables/usePresenter'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()
const userStore = useUserStore()
const authStore = useAuthStore()
const configPresenter = usePresenter('configPresenter')

const avatarError = ref(false)

// 确保用户头像URL是绝对URL
const safeAvatarUrl = computed(() => {
  const url = userStore.avatarUrl
  if (!url) return ''
  
  // 如果已经是完整URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  
  // 否则构建完整URL
  return `https:${url.startsWith('//') ? url : `//${url}`}`
})

// 格式化日期
const formatDate = (dateString?: string) => {
  if (!dateString) return '未知'
  try {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateString
  }
}

// 格式化手机号
const formatPhone = (phone?: string) => {
  if (!phone) return ''
  // 简单格式化，隐藏中间四位
  if (phone.length === 11) {
    return `${phone.slice(0, 3)}****${phone.slice(7)}`
  }
  return phone
}

// 获取账号状态文本
const getStatusText = (status?: number) => {
  switch (status) {
    case 1:
      return '正常'
    case 2:
      return '已禁用'
    case 0:
    default:
      return '未激活'
  }
}

// 获取账号状态样式
const getStatusClass = (status?: number) => {
  switch (status) {
    case 1:
      return 'text-green-500 border-green-500'
    case 2:
      return 'text-red-500 border-red-500'
    case 0:
    default:
      return 'text-yellow-500 border-yellow-500'
  }
}

// 获取登录提供商图标
const getProviderIcon = (providerName: string) => {
  switch (providerName.toLowerCase()) {
    case 'google':
      return 'logos:google-icon'
    case 'github':
      return 'mdi:github'
    case 'wechat':
      return 'ri:wechat-fill'
    default:
      return 'lucide:user'
  }
}

// 退出登录处理函数 - 从AboutUsSettings.vue迁移
const handleLogout = async () => {
  try {
    // 显示确认对话框
    if (!window.confirm(t('about.logoutConfirm'))) {
      return
    }
    
    // 使用authStore的logout方法进行退出登录
    const success = await authStore.logout()
    
    if (success) {
      // 提示用户退出成功
      window.alert(t('about.logoutSuccess'))
      
      // 重定向到登录页面
      router.push({ name: 'login' })
    } else {
      window.alert(t('about.logoutError'))
    }
  } catch (error) {
    console.error('退出登录时出错:', error)
    window.alert(t('about.logoutError'))
  }
}

// 强制修复登录状态 - 从AboutUsSettings.vue迁移
const handleForceLogout = async () => {
  try {
    console.log('开始强制修复登录状态')
    console.log('修复前状态: userStore.isLoggedIn =', userStore.isLoggedIn, 'authStore.isAuthenticated =', authStore.isAuthenticated)
    
    // 清除所有状态
    await authStore.clearToken()
    userStore.clearUserInfo()
    
    // 确保用户信息为空
    await configPresenter.setUserInfo(null)
    await configPresenter.setAuthToken(null)
    
    console.log('修复后状态: userStore.isLoggedIn =', userStore.isLoggedIn, 'authStore.isAuthenticated =', authStore.isAuthenticated)
    
    // 重定向到登录页面
    window.alert('登录状态已修复，将跳转到登录页面')
    router.push({ name: 'login' })
  } catch (error) {
    console.error('修复登录状态时出错:', error)
    window.alert('修复登录状态时出错')
  }
}
</script>
