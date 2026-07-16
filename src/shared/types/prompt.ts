import type { FileItem } from './file'

export interface Prompt {
  id: string
  name: string
  description: string
  content?: string
  parameters?: Array<{
    name: string
    description: string
    required: boolean
  }>
  files?: FileItem[]
  messages?: Array<{ role: string; content: { text: string } }>
  enabled?: boolean
  source?: 'local' | 'imported' | 'builtin'
  createdAt?: number
  updatedAt?: number
}

export interface SystemPrompt {
  id: string
  name: string
  content: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
}
