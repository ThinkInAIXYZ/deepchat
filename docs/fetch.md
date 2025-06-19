# 统一请求类 (Request) 文档

## 概述

DeepChat 项目使用统一的 Request 类来处理所有的 HTTP 请求。这个类提供了一致的接口，自动处理认证、URL 构建、错误处理等功能，简化了网络请求的使用。

## 主要特性

- **自动认证**: 自动添加全局 Bearer token 认证头
- **URL 构建**: 支持相对路径和完整 URL，自动拼接 base URL
- **统一错误处理**: 标准化的错误处理和超时控制
- **Electron 集成**: 支持 `electron.net.fetch` 和普通 `fetch`
- **类型安全**: 完整的 TypeScript 类型支持
- **灵活配置**: 支持自定义头部、跳过认证等选项
- **多种数据格式**: 支持 JSON、文本、Blob、ArrayBuffer 等多种响应格式
- **Headers 兼容性**: 支持对象、数组、Headers 实例等多种头部格式

## 基本用法

### 导入

```typescript
import { request } from './api/request'
```

### 简单的 GET 请求

```typescript
// 使用相对路径（会自动拼接 baseUrl）
const response = await request.get('/api/user/current')
console.log(response.data)

// 使用完整 URL
const response = await request.get('https://api.github.com/user')
console.log(response.data)
```

### POST 请求

```typescript
const response = await request.post('/api/auth/login', {
  username: 'user',
  password: 'pass'
})
```

### 带自定义头部的请求

```typescript
// 使用对象格式（推荐）
const response = await request.get('/api/data', {
  headers: {
    'Custom-Header': 'value'
  }
})

// 使用数组格式
const response2 = await request.get('/api/data', {
  headers: [
    ['Custom-Header', 'value'],
    ['Another-Header', 'value2']
  ]
})
```

### 获取不同格式的响应数据

```typescript
// 获取 JSON 数据（默认）
const jsonResponse = await request.get('/api/data')
console.log(jsonResponse.data)

// 获取 Blob 数据
const blob = await request.getBlob('/api/image.png')

// 获取原始 Response 对象
const rawResponse = await request.getRaw('/api/data')
const customData = await rawResponse.text()

// 获取 ArrayBuffer
const buffer = await request.getArrayBuffer('/api/binary-data')
```

## API 参考

### RequestConfig 接口

```typescript
interface RequestConfig extends RequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: HeadersInit // 支持多种头部格式
  body?: string | FormData | Buffer
  timeout?: number
  baseUrl?: string
  useElectronNet?: boolean // 是否使用 electron.net.fetch
  skipAuth?: boolean // 跳过自动认证
}
```

### RequestResponse 接口

```typescript
interface RequestResponse<T = any> {
  ok: boolean
  status: number
  statusText: string
  data: T
  headers: Headers
}
```

### 主要方法

#### `request.get<T>(url, config)`

执行 GET 请求，返回解析后的数据

#### `request.post<T>(url, data, config)`

执行 POST 请求

#### `request.put<T>(url, data, config)`

执行 PUT 请求

#### `request.delete<T>(url, config)`

执行 DELETE 请求

#### `request.download(url, config)`

下载文件，返回 Buffer

#### `request.getRaw(url, config)`

获取原始 Response 对象，不解析响应体

#### `request.getBlob(url, config)`

直接获取 Blob 数据

#### `request.getArrayBuffer(url, config)`

直接获取 ArrayBuffer 数据

#### `request.getText(url, config)`

直接获取文本数据

## 认证机制

Request 类会自动从全局配置中获取认证 token：

```typescript
// 自动添加认证头
const response = await request.get('/api/protected-route')
// 请求头将包含: Authorization: Bearer <token>

// 跳过自动认证
const response = await request.get('/api/public-route', {
  skipAuth: true
})
```

## 使用示例

### 1. 基本 API 请求

```typescript
export const getUserInfo = async () => {
  const response = await request.get('/api/user/current')
  if (!response.ok) {
    throw new Error(`获取用户信息失败: ${response.status}`)
  }
  return response.data
}
```

### 2. 第三方 API 请求（跳过默认认证）

```typescript
export const getGitHubUser = async (token: string) => {
  const response = await request.get('https://api.github.com/user', {
    skipAuth: true, // 跳过默认认证
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'DeepChat/1.0.0'
    }
  })
  return response.data
}
```

### 3. OAuth 令牌交换

```typescript
export const exchangeCodeForToken = async (code: string, clientId: string, clientSecret: string) => {
  const response = await request.post('https://github.com/login/oauth/access_token', {
    client_id: clientId,
    client_secret: clientSecret,
    code: code
  }, {
    skipAuth: true,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'DeepChat/1.0.0'
    }
  })
  return response.data
}
```

### 4. AI 服务请求

```typescript
export const createChatCompletion = async (apiKey: string, messages: any[], model: string) => {
  const response = await request.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages,
    stream: false
  }, {
    skipAuth: true,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 120000
  })
  return response.data
}
```

### 5. Provider API 状态检查

```typescript
export const getDeepSeekBalance = async (apiKey: string) => {
  const response = await request.get('https://api.deepseek.com/user/balance', {
    skipAuth: true,
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  })
  return response.data
}
```

### 6. 自定义 Base URL

```typescript
export const getSiliconCloudInfo = async (apiKey: string) => {
  const response = await request.get('/v1/user/info', {
    baseUrl: 'https://api.siliconflow.cn',
    skipAuth: true,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })
  return response.data
}
```

### 7. 文件下载

```typescript
export const downloadImage = async (imageUrl: string) => {
  const buffer = await request.download(imageUrl, {
    useElectronNet: false,
    timeout: 60000,
    skipAuth: true
  })
  return buffer
}
```

### 8. 错误处理

```typescript
export const handleRequestErrors = async () => {
  try {
    const response = await request.get('/api/might-fail')
    if (!response.ok) {
      console.error('Request failed:', response.status, response.statusText)
      return null
    }
    return response.data
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        console.error('Request timeout')
      } else {
        console.error('Request error:', error.message)
      }
    }
    return null
  }
}
```

### 9. 获取二进制数据（Blob）

```typescript
export const downloadImageAsBlob = async (imageUrl: string) => {
  const blob = await request.getBlob(imageUrl, {
    skipAuth: true,
    timeout: 60000
  })
  return blob
}
```

### 10. 获取原始 Response 对象

```typescript
export const getResponseWithCustomHandling = async (url: string) => {
  const response = await request.getRaw(url, {
    skipAuth: true
  })
  
  // 可以根据需要自定义处理响应
  if (response.headers.get('content-type')?.includes('image/')) {
    return await response.blob()
  } else {
    return await response.text()
  }
}
```

### 11. 获取 ArrayBuffer 数据

```typescript
export const downloadBinaryData = async (url: string) => {
  const arrayBuffer = await request.getArrayBuffer(url, {
    skipAuth: true
  })
  return Buffer.from(arrayBuffer)
}
```

### 12. 获取纯文本数据

```typescript
export const getPlainText = async (url: string) => {
  const text = await request.getText(url, {
    skipAuth: true
  })
  return text
}
```

### 13. 支持多种 Headers 格式

```typescript
// 对象格式（推荐）
const response1 = await request.get('/api/data', {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer token'
  }
})

// 数组格式
const response2 = await request.get('/api/data', {
  headers: [
    ['Content-Type', 'application/json'],
    ['Authorization', 'Bearer token']
  ]
})

// Headers 对象
const headers = new Headers()
headers.set('Content-Type', 'application/json')
headers.set('Authorization', 'Bearer token')

const response3 = await request.get('/api/data', {
  headers: headers
})
```

## 高级用法

### 处理不同响应类型

```typescript
// 1. 自动检测响应类型
const response = await request.get('/api/endpoint')
// 根据 Content-Type 自动解析为 JSON、文本或 ArrayBuffer

// 2. 强制获取特定格式
const blob = await request.getBlob('/api/image') // 获取 Blob
const buffer = await request.getArrayBuffer('/api/binary') // 获取 ArrayBuffer  
const text = await request.getText('/api/plain-text') // 获取纯文本

// 3. 获取原始 Response 进行自定义处理
const rawResponse = await request.getRaw('/api/data')
if (rawResponse.headers.get('content-type')?.includes('image/')) {
  const imageBlob = await rawResponse.blob()
  // 处理图片数据
} else {
  const textData = await rawResponse.text()
  // 处理文本数据
}
```

### Headers 格式支持

```typescript
// 方式1: 对象格式（最常用）
await request.get('/api/data', {
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  }
})

// 方式2: 数组格式
await request.get('/api/data', {
  headers: [
    ['Authorization', 'Bearer token'],
    ['Content-Type', 'application/json']
  ]
})

// 方式3: Headers 实例
const headers = new Headers()
headers.set('Authorization', 'Bearer token')
headers.set('Content-Type', 'application/json')

await request.get('/api/data', { headers })
```

## 配置选项

### 超时设置

```typescript
const response = await request.get('/api/slow-endpoint', {
  timeout: 60000 // 60秒超时
})
```

### 使用普通 fetch 而非 electron.net.fetch

```typescript
const response = await request.get('/api/data', {
  useElectronNet: false
})
```

### 自定义 Base URL

```typescript
const response = await request.get('/api/endpoint', {
  baseUrl: 'https://custom-api.com'
})
```

## 最佳实践

### 1. 对于内部 API

- 使用相对路径，让系统自动添加 base URL
- 依赖自动认证机制

```typescript
// 推荐
const response = await request.get('/api/user/current')

// 不推荐
const response = await request.get(`${baseUrl}/api/user/current`, {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 2. 对于第三方 API  

- 使用完整 URL
- 设置 `skipAuth: true`
- 显式提供认证头

```typescript
// 推荐
const response = await request.get('https://api.github.com/user', {
  skipAuth: true,
  headers: {
    'Authorization': `Bearer ${githubToken}`,
    'User-Agent': 'DeepChat/1.0.0'
  }
})
```

### 3. 错误处理

- 始终检查 `response.ok`
- 使用 try-catch 捕获网络错误
- 根据错误类型提供合适的用户反馈

### 4. 超时设置

- 对于快速 API，使用默认超时 (30秒)
- 对于 AI 请求或大文件传输，设置更长的超时时间
- 对于实时性要求高的请求，设置较短的超时时间

### 5. 响应数据处理

- 使用 `get()` 方法获取自动解析的数据（JSON/文本/ArrayBuffer）
- 使用 `getBlob()` 直接获取 Blob 数据（适合图片、文件等）
- 使用 `getRaw()` 获取原始 Response 对象进行自定义处理
- 使用 `getArrayBuffer()` 获取二进制数据
- 使用 `getText()` 强制获取文本格式数据

## 迁移指南

### 从原生 fetch 迁移

```typescript
// 旧代码
const response = await fetch('/api/user/current', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
const data = await response.json()

// 新代码
const response = await request.get('/api/user/current')
const data = response.data
```

### 从 Electron net.fetch 迁移

```typescript
// 旧代码
const response = await net.fetch(url, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(data)
})

// 新代码
const response = await request.post(url, data, {
  useElectronNet: true
})
```

## 注意事项

1. **认证头优先级**: 自定义 headers 中的 Authorization 会覆盖自动添加的认证头
2. **URL 处理**: 相对路径会自动拼接 base URL，完整 URL 会直接使用
3. **超时控制**: 默认 30 秒超时，可以根据需要调整
4. **错误类型**: 网络错误会抛出异常，HTTP 错误状态码不会抛出异常但 `ok` 字段为 false
5. **Headers 格式**: 系统会自动规范化不同格式的 headers（对象、数组、Headers 实例）
6. **响应解析**: `get()` 方法会根据 Content-Type 自动选择解析方式，如需特定格式请使用对应的专用方法
7. **内存管理**: 对于大文件下载，建议使用 `getBlob()` 或 `getArrayBuffer()` 而非 `get()` 方法
