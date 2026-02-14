# 火山方舟深度支持 - 实现计划

> 状态: ✅ API 已验证 | 文档版本: v1.0

---

## 1. 架构概览

### 1.1 系统架构图

```
DeepChat App
├── 渲染层 (Renderer)
│   ├── Settings → DoubaoModelManager.vue
│   ├── ChatView → VideoPlayer.vue (新增)
│   └── 通用 → ReasoningContent.vue (新增)
│
└── 主进程 (Main)
    └── presenters/
        └── llmProviderPresenter/
            └── providers/
                └── doubaoProvider.ts (扩展)
                    ├── extends OpenAICompatibleProvider
                    ├── 覆盖 coreStream() → 按类型路由
                    ├── 实现 handleImageGeneration()
                    ├── 实现 handleVideoGeneration()
                    └── 实现 图片/视频缓存
```

### 1.2 数据流

#### Chat 流 (已存在，需增强)
```
User Message → doubaoProvider.coreStream()
             → super.coreStream() [OpenAI兼容]
             → Render reasoning_content (新增)
```

#### Image 流 (新增)
```
User Prompt → 检测 model 类型为 Image
            → handleImageGeneration()
            → 转换参数 (size, watermark...)
            → POST /images/generations
            → 下载图片 → 本地缓存
            → renderImage(url)
```

#### Video 流 (新增)
```
User Prompt → 检测 model 类型为 Video  
            → handleVideoGeneration()
            → 构建 prompt + 参数
            → POST /contents/generations/tasks
            → 返回 taskId
            → 轮询 GET /tasks/{id}
              (每隔 2s，最多 300 次)
            → 状态 queued → processing → completed
            → 下载视频 → 本地缓存
            → renderVideo(url)
```

---

## 2. 文件修改清单

### 2.1 Core Types

| 文件 | 修改 | 说明 |
|------|------|------|
| `src/shared/model.ts` | +4 行 | 添加 ModelType.VideoGeneration |
| `src/shared/types/core/llm-events.ts` | +15 行 | 添加 videoData, reasoningContent 事件 |
| `src/shared/types/presenters/llmprovider.d.ts` | +20 行 | 扩展 MODEL_META 支持火山特有配置 |

### 2.2 Provider Implementation

| 文件 | 修改 | 说明 |
|------|------|------|
| `src/main/presenter/llmProviderPresenter/providers/doubaoProvider.ts` | ~+300 行 | 扩展为完整多模态 provider |
| `src/main/utils/mediaCache.ts` | ~+150 行 | 图片/视频下载缓存工具 (新建) |

### 2.3 UI Components

| 文件 | 修改 | 说明 |
|------|------|------|
| `src/renderer/settings/DoubaoModelManager.vue` | ~+200 行 | 火山模型管理配置页 (新建) |
| `src/renderer/components/VideoPlayer/VideoPlayer.vue` | ~+150 行 | 视频播放器组件 (新建) |
| `src/renderer/components/ChatView/ReasoningBlock.vue` | ~+80 行 | 推理过程展示 (新建) |
| `src/renderer/components/ChatView/MessageItem.vue` | ~+50 行 | 集成 VideoPlayer, ReasoningBlock |

### 2.4 i18n

| 文件 | 修改 | 说明 |
|------|------|------|
| `src/renderer/src/i18n/zh-CN.json` | +30 keys | 中文翻译 |
| `src/renderer/src/i18n/en-US.json` | +30 keys | 英文翻译 |

---

## 3. 核心代码实现

### 3.1 doubaoProvider.ts 扩展

```typescript
export class DoubaoProvider extends OpenAICompatibleProvider {
  
  // ========== 路由主入口 ==========
  
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    
    const modelType = this.getModelType(modelId)
    
    switch (modelType) {
      case ModelType.ImageGeneration:
        yield* this.handleImageGeneration(messages, modelId)
        return
        
      case ModelType.VideoGeneration:
        yield* this.handleVideoGeneration(messages, modelId, modelConfig)
        return
        
      default:
        // Chat (含 vision, reasoning)
        yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
    }
  }
  
  // ========== 图片生成 ==========
  
  private async *handleImageGeneration(
    messages: ChatMessage[],
    modelId: string
  ): AsyncGenerator<LLMCoreStreamEvent> {
    
    const prompt = this.extractLastText(messages)
    
    // OpenAI → 火山 参数转换
    const volcanoParams = {
      model: modelId,
      prompt,
      size: this.convertSize(modelConfig.size),      // 1024x1024 → 2K
      response_format: 'url',
      sequential_image_generation: 'disabled',       // 固定值
      watermark: modelConfig.watermark ?? false
    }
    
    const result = await this.fetchVolcano('/images/generations', volcanoParams)
    
    // 下载缓存
    const localUrl = await mediaCache.saveImage(result.data[0].url)
    
    yield createStreamEvent.imageData({
      url: localUrl,
      mimeType: 'deepchat/image-url'
    })
    
    yield createStreamEvent.stop('complete')
  }
  
  // ========== 视频生成 ==========
  
  private async *handleVideoGeneration(
    messages: ChatMessage[],
    modelId: string,
    config: ModelConfig
  ): AsyncGenerator<LLMCoreStreamEvent> {
    
    const textPrompt = this.extractLastText(messages)
    const imageUrl = this.extractLastImage(messages)  // 可选
    
    // 构建带参数的 prompt
    const fullPrompt = [
      textPrompt,
      `--resolution ${config.resolution || '1080p'}`,
      `--duration ${config.duration || 5}`,
      `--camerafixed ${config.cameraFixed ?? false}`,
      `--watermark ${config.watermark ?? false}`
    ].join(' ')
    
    // 提交任务
    const content: any[] = [{ type: 'text', text: fullPrompt }]
    if (imageUrl) {
      content.push({ type: 'image_url', image_url: { url: imageUrl } })
    }
    
    const { id: taskId } = await this.fetchVolcano('/contents/generations/tasks', {
      model: modelId,
      content
    })
    
    // 轮询
    yield* this.pollVideoTask(taskId)
  }
  
  private async *pollVideoTask(taskId: string): AsyncGenerator<LLMCoreStreamEvent> {
    const MAX_ATTEMPTS = 300  // 10 分钟
    
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const status = await this.fetchVolcano(`/contents/generations/tasks/${taskId}`)
      
      switch (status.status) {
        case 'queued':
          yield createStreamEvent.progress({ percent: 5, status: '排队中' })
          break
          
        case 'processing':
          const percent = Math.min(50 + i * 0.5, 95)
          yield createStreamEvent.progress({ percent, status: '生成中' })
          break
          
        case 'completed':
          const videoUrl = await mediaCache.saveVideo(status.video_url)
          yield createStreamEvent.videoData({
            url: videoUrl,
            cover: status.cover_url,
            duration: status.duration
          })
          yield createStreamEvent.stop('complete')
          return
          
        case 'failed':
          yield createStreamEvent.error(status.error?.message || '生成失败')
          yield createStreamEvent.stop('error')
          return
      }
      
      await sleep(2000)
    }
    
    yield createStreamEvent.error('生成超时')
    yield createStreamEvent.stop('error')
  }
  
  // ========== 工具方法 ==========
  
  private getModelType(modelId: string): ModelType {
    if (/seedance/i.test(modelId)) return ModelType.VideoGeneration
    if (/seedream/i.test(modelId)) return ModelType.ImageGeneration
    if (/embedding/i.test(modelId)) return ModelType.Embedding
    return ModelType.Chat
  }
  
  private convertSize(openaiSize: string): string {
    const map: Record<string, string> = {
      '1024x1024': '1K',
      '2048x2048': '2K'
    }
    return map[openaiSize] || '2K'
  }
  
  private async fetchVolcano(endpoint: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    
    if (!res.ok) throw new Error(`Volcano API ${res.status}: ${await res.text()}`)
    return res.json()
  }
}
```

---

## 4. 测试策略

### 4.1 单元测试

```typescript
// test/main/doubaoProvider.test.ts

describe('DoubaoProvider', () => {
  describe('getModelType', () => {
    it('识别 seedance 为 Video', () => {
      expect(provider.getModelType('doubao-seedance-xxx'))
        .toBe(ModelType.VideoGeneration)
    })
    
    it('识别 seedream 为 Image', () => {
      expect(provider.getModelType('doubao-seedream-xxx'))
        .toBe(ModelType.ImageGeneration)
    })
  })
  
  describe('convertSize', () => {
    it('1024x1024 → 1K', () => {
      expect(provider.convertSize('1024x1024')).toBe('1K')
    })
    
    it('2048x2048 → 2K', () => {
      expect(provider.convertSize('2048x2048')).toBe('2K')
    })
  })
})
```

### 4.2 集成测试

- [ ] Chat 完整对话流
- [ ] Image 生成并下载
- [ ] Video 提交任务并轮询
- [ ] 错误处理（额度不足、内容违规）

---

## 5. 交付物

- [x] SPEC.md (本目录)
- [x] PLAN.md (本目录)
- [ ] TASKS.md (本目录)
- [x] 验证代码 (`test-volcano/volcano-api.js`)
- [x] 验证结果 (`test-volcano/results.json`)
- [ ] 实现代码 (PR 提交)
