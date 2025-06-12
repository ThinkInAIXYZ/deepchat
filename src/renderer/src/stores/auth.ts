import { onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import { DEEPLINK_EVENTS } from '@/events'
import router from '@/router'
import { usePresenter } from '@/composables/usePresenter'
import { useUserStore } from '@/stores/user'

export const useAuthStore = defineStore('auth', () => {
  const configPresenter = usePresenter('configPresenter')

  // 状态
  const token = ref<string | null>(null)
  const isAuthenticated = ref(false)
  const isLoading = ref(false)

  // 检查是否已登录，并更新相关状态
  const checkIsLogin = async () => {
    try {
      isLoading.value = true

      // 等待Promise解析为实际值
      const savedToken = await configPresenter.getAuthToken()
      console.log('检查登录状态, token:', savedToken, 'type:', typeof savedToken)

      // 检查userInfo
      const userInfoData = await configPresenter.getUserInfo()
      console.log('用户信息:', userInfoData)

      // 判断登录状态 - 确保token不仅存在且不等于字符串'null'和'undefined'
      const loginStatus = !!savedToken && savedToken !== 'null' && savedToken !== 'undefined'
      console.log('登录状态判断结果:', loginStatus)

      // 更新响应式变量
      token.value = savedToken
      isAuthenticated.value = loginStatus

      // 如果登录状态变更，同步更新用户信息
      if (loginStatus && userInfoData) {
        const userStore = useUserStore()
        userStore.updateUserInfo(userInfoData)
      }

      return loginStatus
    } catch (error) {
      console.error('检查登录状态时出错:', error)
      isAuthenticated.value = false
      token.value = null
      return false
    } finally {
      isLoading.value = false
    }
  }

  // 保存令牌
  const setToken = (newToken: string) => {
    token.value = newToken
    isAuthenticated.value = true
    // 使用configPresenter存储token而不是localStorage
    configPresenter.setAuthToken(newToken)
    console.log('已保存认证令牌')
  }

  // 清除令牌（登出时使用）
  const clearToken = async () => {
    token.value = null
    isAuthenticated.value = false
    // 使用configPresenter清除token
    configPresenter.setAuthToken(null)
    // 同时清除用户信息
    const userStore = useUserStore()
    userStore.clearUserInfo()
    console.log('已清除认证令牌和用户信息')

    // 重新检查登录状态
    await checkIsLogin()
  }

  // 退出登录
  const logout = async () => {
    try {
      // 获取API基础URL
      const userStore = useUserStore()
      const apiBaseUrl = await userStore.getApiBaseUrl()

      console.log('开始退出登录流程...')

      // 调用退出登录接口
      if (token.value) {
        const response = await fetch(`${apiBaseUrl}/api/user/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.value}`,
            'Content-Type': 'application/json'
          }
        })

        if (!response.ok) {
          console.error('退出登录失败:', response.status, response.statusText)
        }
      }

      // 无论接口调用是否成功，都清理本地数据
      console.log('清理本地登录数据...')
      await clearToken()

      console.log('退出登录完成，登录状态:', isAuthenticated.value)

      return true
    } catch (error) {
      console.error('退出登录时出错:', error)
      return false
    }
  }

  // 初始化 - 从configPresenter加载现有token
  const initAuth = async () => {
    await checkIsLogin()
  }
  const setupProviderListener = () => {
    // 处理登录成功的DeepLink事件
    console.log('监听处理登录成功的DeepLink事件')
    window.electron.ipcRenderer.on(DEEPLINK_EVENTS.LOGIN_SUCCESS, async (_, data) => {
      console.log('收到登录成功事件:', data)
      if (data && data.token) {
        setToken(data.token)

        // 加载用户信息（主进程已经获取并保存了用户信息，这里只是从配置中加载）
        const userStore = useUserStore()
        const userInfo = await configPresenter.getUserInfo()
        if (userInfo) {
          userStore.updateUserInfo(userInfo)
          router.push({ name: 'profile' })
        }
      }
    })
  }


  // 初始化
  initAuth()

  // 在 store 创建时初始化
  onMounted(async () => {
    await initAuth()
    await setupProviderListener()
  })

  return {
    token,
    isAuthenticated,
    isLoading,
    setToken,
    clearToken,
    checkIsLogin,
    logout
  }
})
