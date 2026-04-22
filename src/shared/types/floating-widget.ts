import type { Agent } from './agent-interface'

export type FloatingWidgetSessionStatus = 'in_progress' | 'done' | 'error'

export interface FloatingWidgetSessionAgent {
  id: string
  name: string
  type: Agent['type']
  icon?: string
  avatar?: Agent['avatar']
}

export interface FloatingWidgetSessionItem {
  id: string
  title: string
  status: FloatingWidgetSessionStatus
  updatedAt: number
  agent: FloatingWidgetSessionAgent
}

export interface FloatingWidgetSnapshot {
  expanded: boolean
  activeCount: number
  sessions: FloatingWidgetSessionItem[]
}
