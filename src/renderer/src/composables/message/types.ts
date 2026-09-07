export interface CaptureOptions {
  messageId: string
  parentId?: string
  fromTop?: boolean
  modelInfo?: {
    model_name: string
    model_provider: string
  }
}
