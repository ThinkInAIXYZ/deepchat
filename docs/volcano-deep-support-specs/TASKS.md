# 火山方舟深度支持 - 任务清单

> 状态: 待开始 | 预估工期: 7-10 天 | 文档版本: v1.0

---

## 📋 任务总览

| Phase | 名称 | 任务数 | 工期 | 优先级 |
|-------|------|--------|------|--------|
| P1 | 类型系统与事件 | 3 | 0.5 天 | P0 |
| P2 | Provider 核心实现 | 5 | 2-3 天 | P0 |
| P3 | 媒体缓存工具 | 2 | 1 天 | P0 |
| P4 | UI 组件 | 4 | 2-3 天 | P1 |
| P5 | 设置页面 | 2 | 1 天 | P1 |
| P6 | 测试与文档 | 3 | 1-2 天 | P1 |

---

## Phase 1: 类型系统与事件 (P1)

### T1.1 - 添加模型类型
**文件**: `src/shared/model.ts`
**验收标准**:
- [ ] 添加 `VideoGeneration = 'videoGeneration'` 到 `ModelType` enum
- [ ] 添加 `Reasoning = 'reasoning'` 到 capabilities (可选)

**代码**:
```typescript
export enum ModelType {
  Chat = 'chat',
  Embedding = 'embedding',
  Rerank = 'rerank',
  ImageGeneration = 'imageGeneration',
  VideoGeneration = 'videoGeneration'  // 新增
}
```

---

### T1.2 - 扩展流事件类型
**文件**: `src/shared/types/core/llm-events.ts`
**验收标准**:
- [ ] 添加 `VideoDataEvent` 类型
- [ ] 添加 `ReasoningContentEvent` 类型 (用于展示思维链)
- [ ] 添加对应的 `createStreamEvent` 方法

**代码**:
```typescript
export interface LLMVideoDataEvent {
  type: 'videoData'
  data: {
    url: string
    cover?: string
    duration?: number
  }
}

export interface LLMReasoningContentEvent {
  type: 'reasoningContent'
  data: {
    content: string
  }
}

export const createStreamEvent = {
  // ... existing
  videoData: (data: LLMVideoDataEvent['data']): LLMVideoDataEvent => 
    ({ type: 'videoData', data }),
  reasoningContent: (content: string): LLMReasoningContentEvent =>
    ({ type: 'reasoningContent', data: { content } })
}
```

---

### T1.3 - 扩展消息类型
**文件**: `src/shared/types/message.ts`
**验收标准**:
- [ ] Message 类型支持 `reasoningContent` 字段

---

## Phase 2: Provider 核心 (P2)

### T2.1 - doubaoProvider 路由逻辑
**文件**: `src/main/presenter/llmProviderPresenter/providers/doubaoProvider.ts`
**验收标准**:
- [ ] 覆盖 `coreStream()` 方法
- [ ] 根据 `modelId` 路由到不同 handler
- [ ] Chat 调用父类方法
- [ ] Image/Video 调用自定义 handler

**代码框架**:
```typescript
async *coreStream(...) {
  const modelType = this.getModelType(modelId)
  
  switch (modelType) {
    case ModelType.ImageGeneration:
      yield* this.handleImageGeneration(messages, modelId)
      return
    case ModelType.VideoGeneration:
      yield* this.handleVideoGeneration(messages, modelId, modelConfig)
      return
    default:
      yield* super.coreStream(...)
  }
}

private getModelType(modelId: string): ModelType {
  if (/seedance/i.test(modelId)) return ModelType.VideoGeneration
  if (/seedream/i.test(modelId)) return ModelType.ImageGeneration
  return ModelType.Chat
}
```

---

### T2.2 - Image 生成实现
**验收标准**:
- [ ] 实现 `handleImageGeneration()`
- [ ] 参数转换 (size, watermark)
- [ ] 调用火山 `/images/generations`
- [ ] 解析响应获取图片 URL
- [ ] 集成媒体缓存

---

### T2.3 - Video 生成实现
**验收标准**:
- [ ] 实现 `handleVideoGeneration()`
- [ ] 构建带参数的 prompt (flags 格式)
- [ ] 调用火山 `/contents/generations/tasks`
- [ ] 实现 `pollVideoTask()` 轮询
- [ ] 处理所有状态 (queued/processing/completed/failed)
- [ ] 集成媒体缓存

---

### T2.4 - Reasoning 支持
**验收标准**:
- [ ] 解析 Chat 响应中的 `reasoning_content`
- [ ] 生成 `reasoningContent` 流事件

---

### T2.5 - 错误处理
**验收标准**:
- [ ] 处理额度不足 (`insufficient_quota`)
- [ ] 处理内容违规 (`content_policy_violation`)
- [ ] 处理超时
- [ ] 友好错误提示

---

## Phase 3: 媒体缓存工具 (P3)

### T3.1 - 创建 mediaCache.ts
**文件**: `src/main/utils/mediaCache.ts` (新建)
**验收标准**:
- [ ] 实现 `saveImage(url): Promise<localPath>`
- [ ] 实现 `saveVideo(url): Promise<localPath>`
- [ ] 使用 `app.getPath('userData')/media` 作为缓存目录
- [ ] 生成唯一文件名 (hash)
- [ ] 返回 `deepchat-media://` 协议 URL

**代码框架**:
```typescript
import { app } from 'electron'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs/promises'

class MediaCache {
  private cacheDir: string

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'media-cache')
    this.ensureDir()
  }

  async saveImage(url: string): Promise<string> {
    const buffer = await fetch(url).then(r => r.arrayBuffer())
    const hash = crypto.createHash('md5').update(url).digest('hex')
    const ext = '.jpg'
    const filePath = path.join(this.cacheDir, `img-${hash}${ext}`)
    await fs.writeFile(filePath, Buffer.from(buffer))
    return `deepchat-media://${filePath}`
  }

  async saveVideo(url: string): Promise<string> {
    // 类似实现，扩展名 .mp4
  }

  async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000) {
    // 清理过期文件
  }
}

export const mediaCache = new MediaCache()
```

---

### T3.2 - 协议处理
**文件**: `src/main/...` (待定)
**验收标准**:
- [ ] 注册 `deepchat-media://` 协议处理器
- [ ] 允许 renderer 安全访问缓存文件

---

## Phase 4: UI 组件 (P4)

### T4.1 - 视频播放器组件
**文件**: `src/renderer/components/VideoPlayer/VideoPlayer.vue` (新建)
**验收标准**:
- [ ] 使用 HTML5 `<video>`
- [ ] 支持 controls (播放/暂停/进度/全屏)
- [ ] 显示 cover 作为 poster
- [ ] 加载状态
- [ ] 显示时长
- [ ] 下载按钮

**Props**:
```typescript
interface Props {
  src: string        // deepchat-media:// 协议 URL
  cover?: string     // 封面图
  duration?: number  // 时长(秒)
  onDownload?: () => void
}
```

---

### T4.2 - 推理内容展示
**文件**: `src/renderer/components/ChatView/ReasoningBlock.vue` (新建)
**验收标准**:
- [ ] 可折叠/展开
- [ ] 显示 "思考过程" 标签
- [ ] Markdown 渲染
- [ ] 默认折叠 (避免占用空间)

---

### T4.3 - 生成进度组件
**文件**: `src/renderer/components/GenerationProgress/GenerationProgress.vue` (新建)
**验收标准**:
- [ ] 进度条 (percent)
- [ ] 状态文字 (排队中/生成中)
- [ ] 取消按钮

---

### T4.4 - 集成到 MessageItem
**文件**: `src/renderer/components/ChatView/MessageItem.vue`
**验收标准**:
- [ ] 检测到 videoData 显示 VideoPlayer
- [ ] 检测到 reasoningContent 显示 ReasoningBlock
- [ ] 检测到 progress 显示 GenerationProgress

---

## Phase 5: 设置页面 (P5)

### T5.1 - 火山模型管理器
**文件**: `src/renderer/settings/DoubaoModelManager.vue` (新建)
**验收标准**:
- [ ] 显示已配置模型列表
- [ ] 输入框添加新模型 ID
- [ ] 自动识别模型类型
- [ ] 手动选择类型（识别失败时）
- [ ] 删除模型
- [ ] Region 选择 (beijing/shanghai)
- [ ] i18n 支持

**界面草图**:
```
┌─────────────────────────────────┐
│ 豆包/火山引擎模型管理            │
├─────────────────────────────────┤
│ Region: [cn-beijing ▼]          │
├─────────────────────────────────┤
│ 已添加模型:                      │
│ • doubao-seed-2-0 (Chat) [删除] │
│ • doubao-seedream (Image) [删除]│
│ • doubao-seedance (Video) [删除]│
├─────────────────────────────────┤
│ 添加新模型:                      │
│ [输入模型ID          ] [识别]   │
│ 类型: [自动 ▼]                   │
│ [添加]                           │
└─────────────────────────────────┘
```

---

### T5.2 - 集成到设置路由
**文件**: `src/renderer/settings/routes.ts`
**验收标准**:
- [ ] 添加火山模型管理入口

---

## Phase 6: 测试与文档 (P6)

### T6.1 - 单元测试
**文件**: `test/main/doubaoProvider.test.ts`
**验收标准**:
- [ ] 测试 `getModelType()`
- [ ] 测试 `convertSize()`
- [ ] 测试参数构建

### T6.2 - E2E 测试
**验收标准**:
- [ ] Chat 对话完整流程
- [ ] Image 生成并显示
- [ ] Video 提交、轮询、完成流程
- [ ] 错误场景测试

### T6.3 - 更新主 README
**文件**: `specs/deepchat/README.md` 和项目文档
**验收标准**:
- [ ] 更新进度状态
- [ ] 添加火山引擎支持说明

---

## 📊 实施建议

### 开发顺序

```
Day 1: P1 (类型) + P3 (缓存工具)
Day 2-3: P2 (Provider 核心)
Day 4-5: P4 (UI 组件)  
Day 6: P5 (设置页面)
Day 7-8: P6 (测试) + bugfix
```

### PR 策略

| PR | 内容 | 大小 |
|----|------|------|
| #1 | P1 + P3 (基础类型和工具) | 小 |
| #2 | P2 (Provider 核心实现) | 大 |
| #3 | P4 + P5 (UI 和设置) | 中 |
| #4 | P6 (测试和文档) | 小 |

---

## ✅ 前置检查清单

开始实施前确认:
- [x] API Key 已验证可用
- [x] 三个模型 (Chat/Image/Video) 已开通
- [x] 接口行为已完全理解
- [x] SPEC/PLAN/TASK 文档已批准
