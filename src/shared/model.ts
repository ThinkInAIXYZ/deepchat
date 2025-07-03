// src/shared/presenter.ts
// 实现 enum 及运行时需要的导出，避免 Vite 报错

export enum ModelType {
  Chat = 'chat',
  Embedding = 'embedding',
  Rerank = 'rerank',
  ImageGeneration = 'imageGeneration',
  RAG = 'rag'
}

// 注意：ConversationType 已移动到 chat.d.ts 中
