<template>
  <div class="w-full h-full flex flex-col items-center justify-center bg-background p-4">
    <div class="w-full max-w-md space-y-6">
      <!-- 标题和Logo -->
      <div class="flex flex-col items-center space-y-2">
        <img src="@/assets/logo.png" class="w-16 h-16" alt="DeepChat Logo" />
        <h1 class="text-2xl font-bold">{{ t('login.welcome') }}</h1>
        <p class="text-muted-foreground text-sm text-center">
          {{ t('login.description') }}
        </p>
      </div>

      <!-- 主要登录表单 -->
      <div class="space-y-4">
        <!-- 手机号输入 -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <!-- 国家代码选择 -->
            <div class="relative">
              <Button
                variant="outline"
                class="w-20 justify-center px-2"
                @click="showCountrySelector = !showCountrySelector"
              >
                <span class="text-sm">{{ selectedCountry.code }}</span>
                <Icon icon="lucide:chevron-down" class="w-4 h-4 ml-1" />
              </Button>
              
              <!-- 国家代码下拉菜单 -->
              <div 
                v-if="showCountrySelector"
                class="absolute top-full left-0 mt-1 w-32 bg-background border border-border rounded-md shadow-lg z-10 max-h-40 overflow-y-auto"
              >
                <div
                  v-for="country in countries"
                  :key="country.code"
                  @click="selectCountry(country)"
                  class="px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                >
                  {{ country.code }} {{ country.name }}
                </div>
              </div>
            </div>
            
            <!-- 手机号输入框 -->
            <Input 
              v-model="phoneForm.phone" 
              type="tel" 
              :placeholder="t('login.phonePlaceholder')"
              class="flex-1"
            />
          </div>
        </div>
        
        <!-- 短信验证码 -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <Input 
              v-model="phoneForm.code" 
              type="text" 
              :placeholder="t('login.codePlaceholder')"
              class="flex-1"
            />
            <Button 
              variant="outline" 
              class="w-32 whitespace-nowrap text-primary"
              :disabled="isCodeSending || !phoneForm.phone || codeCountdown > 0"
              @click="handleSendCode"
            >
              <span v-if="isCodeSending" class="mr-2">
                <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
              </span>
              <span v-if="codeCountdown > 0">{{ codeCountdown }}s</span>
              <span v-else>{{ t('login.sendCode') }}</span>
            </Button>
          </div>
        </div>
        
        <!-- 邀请码（可选） -->
        <div class="space-y-2">
          <Input 
            v-model="phoneForm.inviteCode" 
            type="text" 
            :placeholder="t('login.inviteCodePlaceholder')"
          />
        </div>
        
        <!-- 注册/登录按钮 -->
        <Button 
          type="submit" 
          class="w-full h-12 bg-primary text-primary-foreground"
          :disabled="isLoading || !phoneForm.phone || !phoneForm.code"
          @click="handlePhoneLogin"
        >
          <span v-if="isLoading" class="mr-2">
            <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
          </span>
          {{ t('login.registerButton') }}
        </Button>
        
        <!-- 保持登录和邮箱登录 -->
        <div class="flex items-center justify-between text-sm">
          <div class="flex items-center space-x-2">
            <input 
              id="keep-login" 
              v-model="keepLogin" 
              type="checkbox" 
              class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
            />
            <label for="keep-login" class="text-muted-foreground cursor-pointer">
              {{ t('login.keepLogin') }}
            </label>
          </div>
          <button 
            @click="showEmailLogin = true"
            class="text-primary hover:underline"
          >
            {{ t('login.emailLogin') }}
          </button>
        </div>
      </div>

      <!-- 其它登录方式 -->
      <div class="space-y-4">
        <div class="text-center text-sm text-muted-foreground">
          {{ t('login.otherLoginMethods') }}
        </div>
        
        <div class="flex justify-center space-x-4">
          <Button 
            variant="outline" 
            size="icon"
            class="w-12 h-12 rounded-full"
            @click="handleSocialLogin('google')"
          >
            <Icon icon="logos:google-icon" class="w-6 h-6" />
          </Button>
          
          <Button 
            variant="outline" 
            size="icon"
            class="w-12 h-12 rounded-full"
            @click="handleSocialLogin('github')"
          >
            <Icon icon="mdi:github" class="w-6 h-6" />
          </Button>
          
          <Button 
            variant="outline" 
            size="icon"
            class="w-12 h-12 rounded-full"
            @click="handleSocialLogin('wechat')"
          >
            <Icon icon="ri:wechat-fill" class="w-6 h-6 text-green-600" />
          </Button>
        </div>
      </div>

      <!-- 用户协议 -->
      <div class="flex items-start space-x-2 text-sm">
        <input 
          id="agree-terms" 
          v-model="agreeTerms" 
          type="checkbox" 
          class="w-4 h-4 text-primary border-border rounded focus:ring-primary mt-0.5"
        />
        <label for="agree-terms" class="text-muted-foreground leading-relaxed cursor-pointer">
          {{ t('login.termsText') }}
          <a href="#" class="text-primary hover:underline">{{ t('login.termsLink') }}</a>
          {{ t('login.andText') }}
          <a href="#" class="text-primary hover:underline">{{ t('login.privacyLink') }}</a>
        </label>
      </div>
    </div>

    <!-- 邮箱登录弹窗 -->
    <div 
      v-if="showEmailLogin"
      class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      @click="showEmailLogin = false"
    >
      <div 
        class="bg-background rounded-lg p-6 w-full max-w-md space-y-4"
        @click.stop
      >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">{{ t('login.emailLogin') }}</h2>
          <Button 
            variant="ghost" 
            size="icon"
            @click="showEmailLogin = false"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </Button>
        </div>
        
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="email">{{ t('login.accountLabel') }}</Label>
            <Input 
              id="email" 
              v-model="emailForm.account" 
              type="email" 
              :placeholder="t('login.accountPlaceholder')"
            />
          </div>
          
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label for="email-password">{{ t('login.passwordLabel') }}</Label>
              <a href="#" class="text-xs text-primary hover:underline">
                {{ t('login.forgotPassword') }}
              </a>
            </div>
            <Input 
              id="email-password" 
              v-model="emailForm.password" 
              type="password" 
              :placeholder="t('login.passwordPlaceholder')"
            />
          </div>
          
          <Button 
            type="submit" 
            class="w-full"
            :disabled="isLoading || !emailForm.account || !emailForm.password"
            @click="handleEmailLogin"
          >
            <span v-if="isLoading" class="mr-2">
              <Icon icon="eos-icons:loading" class="animate-spin w-4 h-4" />
            </span>
            {{ t('login.loginButton') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const apiBaseUrl = import.meta.env.VITE_BASE_API_URL

console.log('import.meta.env', import.meta.env);

// 国家代码选项
const countries = [
  { code: '+86', name: '中国' },
  { code: '+1', name: '美国' },
  { code: '+44', name: '英国' },
  { code: '+81', name: '日本' },
  { code: '+82', name: '韩国' }
]
const selectedCountry = ref(countries[0])
const showCountrySelector = ref(false)

// 表单状态
const phoneForm = ref({
  phone: '',
  code: '',
  inviteCode: ''
})

const emailForm = ref({
  account: '',
  password: ''
})

// UI状态
const showEmailLogin = ref(false)
const keepLogin = ref(true)
const agreeTerms = ref(false)

// 加载状态
const isLoading = ref(false)
const isCodeSending = ref(false)
const codeCountdown = ref(0)

// 初始检查登录状态
onMounted(async () => {
  const isLoggedIn = await authStore.checkIsLogin()
  if (isLoggedIn) {
    router.push({ name: 'chat' })
  }
  
  // 点击外部关闭国家选择器
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

// 处理点击外部关闭国家选择器
const handleClickOutside = (event: Event) => {
  const target = event.target as HTMLElement
  if (!target.closest('.relative')) {
    showCountrySelector.value = false
  }
}

// 选择国家
const selectCountry = (country: typeof countries[0]) => {
  selectedCountry.value = country
  showCountrySelector.value = false
}

// 社交账号登录
const handleSocialLogin = async (provider: 'google' | 'github' | 'wechat') => {
  let authUrl = ''
  switch (provider) {
    case 'google':
      authUrl = `${apiBaseUrl}/oauth2/google`
      break
    case 'github':
      authUrl = `${apiBaseUrl}/oauth2/github`
      break
    case 'wechat':
      authUrl = `${apiBaseUrl}/oauth2/wechat/qrlogin`
      break
  }

  // 打开外部浏览器进行OAuth登录
  window.electron.ipcRenderer.send('open-external-url', authUrl)
}

// 发送验证码
const handleSendCode = async () => {
  if (isCodeSending.value || !phoneForm.value.phone) return
  
  try {
    isCodeSending.value = true

    // 模拟API请求
    console.log('发送验证码：', {
      phone: selectedCountry.value.code + phoneForm.value.phone,
      apiBaseUrl
    })

    // TODO: 实现实际的发送验证码API调用
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 开始倒计时
    codeCountdown.value = 60
    const timer = setInterval(() => {
      codeCountdown.value--
      if (codeCountdown.value <= 0) {
        clearInterval(timer)
      }
    }, 1000)
    
  } catch (error) {
    console.error('发送验证码失败：', error)
  } finally {
    isCodeSending.value = false
  }
}

// 手机号登录
const handlePhoneLogin = async () => {
  if (isLoading.value || !agreeTerms.value) return
  
  try {
    isLoading.value = true

    // TODO: 实现实际的登录API调用
    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log('登录成功')

    router.push({ name: 'chat' })
    
  } catch (error) {
    console.error('登录失败：', error)
  } finally {
    isLoading.value = false
  }
}

// 邮箱登录
const handleEmailLogin = async () => {
  if (isLoading.value) return
  
  try {
    isLoading.value = true
    
    console.log('邮箱登录：', {
      account: emailForm.value.account,
      password: emailForm.value.password,
      apiBaseUrl
    })

    // TODO: 实现实际的登录API调用
    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log('登录成功')

    showEmailLogin.value = false
    router.push({ name: 'chat' })
    
  } catch (error) {
    console.error('登录失败：', error)
  } finally {
    isLoading.value = false
  }
}
</script>
