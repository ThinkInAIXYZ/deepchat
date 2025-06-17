import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import type { UserInfo } from '@shared/presenter'
import { CONFIG_EVENTS } from '@/events'

export const useUserStore = defineStore('user', () => {
  const configPresenter = usePresenter('configPresenter')

  // 状态
  const userInfo = ref<UserInfo | null>(null)
  const apiBaseUrl = ref<string>('https://deepchat.blanplan.com')

  // 计算属性
  console.log('userInfo', userInfo.value)
  console.log('userInfo', userInfo?.value?.avatarUrl)
  const isLoggedIn = computed(() => userInfo.value !== null)
  const avatarUrl = computed(() => {
    console.log('avatarUrl.value', userInfo)
    return userInfo.value?.avatarUrl || ''
  })
  const nickname = computed(() => userInfo.value?.nickname || '')
  const username = computed(() => userInfo.value?.username || '')

  // 初始化 - 从configPresenter加载用户信息
  const initUser = async () => {
    // 先检查认证令牌，如果没有令牌则不应该有用户信息
    const authToken = await configPresenter.getAuthToken()
    const savedUserInfo = await configPresenter.getUserInfo()

    // 同步令牌和用户信息状态
    if (!authToken || authToken === 'null' || authToken === 'undefined') {
      // 如果没有有效的令牌，但有用户信息，则清除用户信息
      if (savedUserInfo) {
        console.log('发现无效令牌但有用户信息，正在清除用户信息...')
        clearUserInfo()
      }
    } else if (savedUserInfo) {
      // 有令牌且有用户信息，正常设置
      userInfo.value = savedUserInfo
      console.log('已从配置中恢复用户信息 savedUserInfo:', savedUserInfo)
      console.log('已从配置中恢复用户信息:', userInfo.value)
    }

    const savedApiBaseUrl = import.meta.env
    if (savedApiBaseUrl) {
      apiBaseUrl.value = savedApiBaseUrl
      console.log('已从配置中恢复API基础URL')
    }

    // 设置事件监听
    setupEventListeners()
  }

  // 更新用户信息
  const updateUserInfo = (newUserInfo: UserInfo) => {
    userInfo.value = newUserInfo
    configPresenter.setUserInfo(newUserInfo)
    console.log('已更新用户信息')
  }

  // 清除用户信息（登出时使用）
  const clearUserInfo = () => {
    userInfo.value = null
    configPresenter.setUserInfo(null)
    console.log('已清除用户信息')
  }

  // 获取用户信息
  const getUserInfo = () => {
    return userInfo.value
  }

  // 设置事件监听
  const setupEventListeners = () => {
    console.log('设置用户Store事件监听')
    // 监听用户信息变更事件
    window.electron.ipcRenderer.on(CONFIG_EVENTS.USER_INFO_CHANGED, (_event, newUserInfo) => {
      console.log('用户Store收到用户信息更新事件:', newUserInfo)
      if (newUserInfo) {
        updateUserInfo(newUserInfo)
      } else {
        clearUserInfo()
      }
    })
  }

  // 初始化
  initUser()

  return {
    userInfo,
    apiBaseUrl,
    isLoggedIn,
    avatarUrl,
    nickname,
    username,
    updateUserInfo,
    clearUserInfo,
    getUserInfo
  }
})
