import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createOAuthClient } from '@api/OAuthClient'
import { openRuntimeExternal } from '@api/runtime'
import type { ChatGPTAuthStatus, ChatGPTLogoutResult } from '@shared/contracts/routes'

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

const signedOut: ChatGPTAuthStatus = {
  state: 'signed-out',
  planUsageEnabled: false,
  storage: 'none',
  notices: { welcome: false, codexRetired: false }
}

/** The ChatGPT account status as the main process reports it, plus its actions. */
export function useChatGPTAuth() {
  const oauthClient = createOAuthClient()
  const status = ref<ChatGPTAuthStatus>(signedOut)
  const busy = ref(false)
  let unsubscribe: (() => void) | null = null

  const isPending = computed(() => status.value.state === 'pending-browser')
  const isConnected = computed(() => status.value.state === 'authenticated')

  const run = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busy.value) return undefined
    busy.value = true
    try {
      return await action()
    } finally {
      busy.value = false
    }
  }

  const refresh = async () => {
    status.value = await oauthClient.getChatGPTStatus()
  }
  const startLogin = (requestPlanConsent = false) =>
    run(async () => {
      status.value = await oauthClient.startChatGPTLogin(
        requestPlanConsent ? { requestPlanConsent } : {}
      )
    })
  const reopenBrowser = async () => {
    status.value = await oauthClient.reopenChatGPTBrowser()
  }
  const cancelLogin = async () => {
    status.value = await oauthClient.cancelChatGPTLogin()
  }
  const logout = () =>
    run<ChatGPTLogoutResult>(async () => {
      const result = await oauthClient.logoutChatGPT()
      status.value = result.status
      return result
    })
  const dismissNotice = async (notice: 'welcome' | 'codexRetired') => {
    status.value = await oauthClient.dismissChatGPTNotice(notice)
  }
  const openUsage = () => openRuntimeExternal(CHATGPT_USAGE_URL)

  onMounted(() => {
    unsubscribe = oauthClient.onChatGPTStatusChanged((next) => {
      status.value = next
    })
    void refresh().catch((error) => console.warn('[ChatGPT] Failed to load status:', error))
  })
  onUnmounted(() => unsubscribe?.())

  return {
    status,
    busy,
    isPending,
    isConnected,
    refresh,
    startLogin,
    reopenBrowser,
    cancelLogin,
    logout,
    dismissNotice,
    openUsage
  }
}
