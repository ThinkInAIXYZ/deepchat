# 火山方舟 (Volcano) Deep Support - 完整规范

> 状态: ✅ API 已验证 | 优先级: P0 | 版本: v1.0

---

## 1. 项目概述

### 1.1 目标
将 DeepChat 的 `doubaoProvider` 扩展为完整支持火山方舟平台的多模态能力：
- ✅ 对话（Chat）- 已验证
- ✅ 图片生成（Image）- 已验证  
- ✅ 视频生成（Video）- 已验证
- 🔄 Embedding（待实现）

### 1.2 已验证的模型

| 模型 ID | 类型 | 验证状态 |
|---------|------|----------|
| `doubao-seed-2-0-code-preview-260215` | Chat + Vision + Reasoning | ✅ 成功 |
| `doubao-seedream-4-0-250828` | Image Generation | ✅ 成功 |
| `doubao-seedance-1-0-pro-fast-251015` | Video Generation | ✅ 成功 |

### 1.3 API 基础信息

```
Base URL: https://ark.cn-beijing.volces.com/api/v3
Auth: Bearer Token
Region: cn-beijing (默认), cn-shanghai
```

---

## 2. API 规范详解

### 2.1 Chat API - 完全 OpenAI 兼容

**端点**: `POST /chat/completions`

**特殊能力**:
- 完全兼容 OpenAI SDK
- 支持 `reasoning_content` 字段（类似 DeepSeek）
- 支持多模态（Vision）

**请求示例**:
```json
{
  "model": "doubao-seed-2-0-code-preview-260215",
  "messages": [{"role": "user", "content": "你好"}],
  "temperature": 0.7,
  "max_tokens": 100
}
```

**响应示例**:
```json
{
  "id": "02177...",
  "model": "doubao-seed-2-0-code-preview-260215",
  "choices": [{
    "message": {
      "content": "你好！我是豆包...",
      "reasoning_content": "用户让我介绍自己..."  // 思维链
    }
  }],
  "usage": {
    "prompt_tokens": 37,
    "completion_tokens": 350,
    "reasoning_tokens": 328   // 新增字段
  }
}
```

### 2.2 Image API - 部分兼容

**端点**: `POST /images/generations`

**与 OpenAI 的差异**:

| 参数 | OpenAI | 火山 | 说明 |
|------|--------|------|------|
| size | `1024x1024` | `1K`/`2K` | 字符串枚举 |
| quality | `standard`/`hd` | - | 无此参数 |
| n | 1-10 | 1 | 固定 |
| watermark | - | `true`/`false` | 新增 |
| sequential_image_generation | - | `disabled` | 固定值 |

**请求示例**:
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "小猫在阳光下打盹",
  "size": "2K",
  "response_format": "url",
  "sequential_image_generation": "disabled",
  "watermark": false
}
```

**响应示例**:
```json
{
  "model": "doubao-seedream-4-0-250828",
  "data": [{
    "url": "https://ark-content-generation-v2...jpg?X-Tos...",
    "size": "2048x2048"
  }],
  "usage": {
    "generated_images": 1,
    "output_tokens": 16384
  }
}
```

### 2.3 Video API - 完全自定义

**端点**: 
- 创建任务: `POST /contents/generations/tasks`
- 查询状态: `GET /contents/generations/tasks/{id}`

**特殊机制**:
- 异步作业模式
- 参数通过 `--flag value` 格式嵌入 prompt
- 最长执行时间: 172800 秒 (48小时)

**请求示例**:
```json
{
  "model": "doubao-seedance-1-0-pro-fast-251015",
  "content": [
    {
      "type": "text",
      "text": "小猫在草地上打滚 --resolution 1080p --duration 5 --watermark false"
    }
  ]
}
```

**参数格式**（嵌入在 text 中）:
```
--resolution 1080p    # 分辨率
--duration 5          # 时长(秒)  
--camerafixed false   # 相机固定
--watermark true      # 水印开关
```

**提交响应**:
```json
{
  "id": "cgt-20260214201926-mpg6p",
  "status": "queued"
}
```

**状态响应**:
```json
{
  "id": "cgt-...",
  "status": "queued",       // queued | processing | completed | failed
  "created_at": 1771071566,
  "updated_at": 1771071566,
  "model": "doubao-seedance-1-0-pro-fast-251015"
}
```

---

## 3. User Stories

### US-1: 用户配置火山模型
> 作为用户，我想从火山控制台复制模型 ID，粘贴到 DeepChat 即可使用

**AC**:
- [ ] 设置页面提供模型管理
- [ ] 粘贴模型 ID 后自动识别类型
- [ ] 识别失败时允许手动选择

### US-2: 使用豆包对话
> 作为用户，我想用豆包进行对话，并看到AI的思考过程

**AC**:
- [ ] Chat 正常工作
- [ ] 支持 `reasoning_content` 展示（可折叠）
- [ ] 支持 Vision（图片理解）

### US-3: 生成图片
> 作为用户，我想通过对话描述生成图片

**AC**:
- [ ] 选择 Seedream 模型
- [ ] 输入描述，系统自动调用图片生成
- [ ] 显示生成的图片
- [ ] 支持下载

### US-4: 生成视频
> 作为用户，我想生成短视频

**AC**:
- [ ] 选择 Seedance 模型
- [ ] 输入描述，提交任务
- [ ] 显示生成进度（排队+处理）
- [ ] 完成后播放视频
- [ ] 支持下载

---

## 4. 技术决策

### 4.1 模型类型识别

根据模型 ID 特征自动推断：

```typescript
function inferModelType(modelId: string): ModelType {
  if (/seedance/i.test(modelId)) return ModelType.VideoGeneration
  if (/seedream/i.test(modelId)) return ModelType.ImageGeneration
  if (/embedding/i.test(modelId)) return ModelType.Embedding
  return ModelType.Chat  // 默认
}

function inferCapabilities(modelId: string): string[] {
  const caps = ['chat']
  if (/vision/i.test(modelId)) caps.push('vision')
  if (/code/i.test(modelId)) caps.push('code')
  if (/reasoning/i.test(modelId)) caps.push('reasoning')
  return caps
}
```

### 4.2 Provider 架构

```
doubaoProvider extends OpenAICompatibleProvider
├── coreStream()
│   ├── 根据 model 类型路由
│   ├── Chat → super.coreStream() [OpenAI兼容]
│   ├── Image → handleImageGeneration() [参数转换]
│   └── Video → handleVideoGeneration() [完全自定义]
│
├── handleImageGeneration()
│   ├── 转换 size 格式 (1024x1024 → 2K)
│   ├── 添加火山特有参数
│   └── 下载缓存图片
│
├── handleVideoGeneration()
│   ├── 构建带参数的 prompt
│   ├── 提交异步任务
│   ├── 轮询状态 (2s 间隔)
│   ├── 下载缓存视频
│   └── 流式进度事件
│
└── fetchProviderModels()
    └── 返回用户配置的模型列表
```

---

## 5. 非目标 (Out of Scope)

- 🚫 语音识别 (ASR)
- 🚫 语音合成 (TTS)
- 🚫 实时音视频对话
- 🚫 模型微调管理
- 🚫 批量推理任务

---

## 6. 参考资料

- 火山方舟文档: https://www.volcengine.com/docs/82379
- 已验证 API 调用代码: `../test-volcano/volcano-api.js`
- 测试结果: `../test-volcano/results.json`
