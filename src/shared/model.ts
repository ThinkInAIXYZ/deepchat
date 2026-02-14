// src/shared/presenter.ts
// Implement enum and runtime exports to avoid Vite errors

export enum ModelType {
  Chat = 'chat',
  Embedding = 'embedding',
  Rerank = 'rerank',
  ImageGeneration = 'imageGeneration',
  VideoGeneration = 'videoGeneration'
}

export enum ApiEndpointType {
  Chat = 'chat',
  Image = 'image',
  Video = 'video'
}
