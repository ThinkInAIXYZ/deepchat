export type FloatingWidgetSessionStatus = 'in_progress' | 'done' | 'error'

export interface FloatingWidgetSessionItem {
  id: string
  title: string
  status: FloatingWidgetSessionStatus
  updatedAt: number
}

export interface FloatingWidgetSnapshot {
  expanded: boolean
  activeCount: number
  sessions: FloatingWidgetSessionItem[]
}
