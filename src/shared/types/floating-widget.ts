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

/** Edge the floating widget is docked to. */
export type FloatingWidgetDockSide = 'left' | 'right'

/**
 * Persisted resting position of the floating button.
 *
 * Stored via configPresenter so the widget reappears where the user last left it.
 * `x` is recorded for completeness; on restore it is recomputed from `dockSide` and
 * the current display work area so the widget always re-docks to an edge.
 */
export interface FloatingButtonBounds {
  x: number
  y: number
  dockSide: FloatingWidgetDockSide
}
