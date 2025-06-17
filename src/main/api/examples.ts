import { request } from './request'

/**
 * 使用示例：展示如何在项目中使用统一的 Request 类
 */

// 1. 基本 API 请求（使用默认 baseUrl）
export const getUserInfo = async (token: string) => {
  const response = await request.get('/api/user/current', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  return response.data
}

// 2. 使用完整 URL 的请求
export const getGitHubUser = async (token: string) => {
  const response = await request.get('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'DeepChat/1.0.0'
    }
  })
  return response.data
}

// 3. POST 请求
export const loginUser = async (credentials: { username: string; password: string }) => {
  const response = await request.post('/api/auth/login', credentials)
  return response.data
}

// 4. 不使用 electron.net.fetch 的请求
export const downloadImage = async (imageUrl: string) => {
  const buffer = await request.download(imageUrl, {
    useElectronNet: false,
    timeout: 60000
  })
  return buffer
}

// 5. GitHub OAuth 请求
export const exchangeCodeForToken = async (code: string, clientId: string, clientSecret: string) => {
  const response = await request.post('https://github.com/login/oauth/access_token', {
    client_id: clientId,
    client_secret: clientSecret,
    code: code
  }, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'DeepChat/1.0.0'
    }
  })
  return response.data
}

// 6. AI 服务请求（OpenAI 风格）
export const createChatCompletion = async (apiKey: string, messages: any[], model: string) => {
  const response = await request.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages,
    stream: false
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 120000
  })
  return response.data
}

// 8. DeepSeek API 请求
export const getDeepSeekBalance = async (apiKey: string) => {
  const response = await request.get('https://api.deepseek.com/user/balance', {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  })
  return response.data
}

// 9. 自定义 baseUrl 的请求
export const getSiliconCloudInfo = async (apiKey: string) => {
  const response = await request.get('/v1/user/info', {
    baseUrl: 'https://api.siliconflow.cn',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })
  return response.data
}

// 10. 错误处理示例
export const handleRequestErrors = async () => {
  try {
    const response = await request.get('/api/might-fail')
    if (!response.ok) {
      console.error('Request failed:', response.status, response.statusText)
      return null
    }
    return response.data
  } catch (error) {
    console.error('Request error:', error)
    return null
  }
}
