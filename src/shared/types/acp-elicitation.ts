import type { ElicitationField } from './elicitation'

export type AcpElicitationField = Omit<ElicitationField, 'options'> & {
  secret?: boolean
  preview?: string
  customAnswerFor?: string
  noteFor?: string
  options?: Array<{ value: string; title: string; description?: string; preview?: string }>
}

export type AcpElicitationValue = string | number | boolean | string[]
export type AcpElicitationDecision = {
  requestId: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, AcpElicitationValue>
}

export type AcpElicitationView = {
  requestId: string
  agentId: string
  agentName: string
  conversationId?: string
  toolCallId?: string
  mode: 'form' | 'url'
  message: string
  fields: AcpElicitationField[]
  url?: string
  expiresAt?: number
  status: 'pending' | 'waiting_external' | 'completed'
}
