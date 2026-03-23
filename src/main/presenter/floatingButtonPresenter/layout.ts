import type { SessionWithState } from '@shared/types/agent-interface'
import type {
  FloatingWidgetSessionItem,
  FloatingWidgetSessionStatus,
  FloatingWidgetSnapshot
} from '@shared/types/floating-widget'

export type FloatingWidgetDockSide = 'left' | 'right'

export interface WidgetRect {
  x: number
  y: number
  width: number
  height: number
}

export const FLOATING_WIDGET_LAYOUT = {
  collapsedIdle: { width: 64, height: 64 },
  collapsedBusy: { width: 64, height: 64 },
  expandedWidth: 388,
  expandedMinHeight: 168,
  expandedMaxHeight: 392,
  expandedHeaderHeight: 68,
  expandedItemHeight: 60,
  expandedBottomPadding: 16,
  maxVisibleSessions: 6
} as const

function mapSessionStatus(status: SessionWithState['status']): FloatingWidgetSessionStatus {
  switch (status) {
    case 'generating':
      return 'in_progress'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'done'
  }
}

function getStatusPriority(status: FloatingWidgetSessionStatus): number {
  switch (status) {
    case 'in_progress':
      return 0
    case 'error':
      return 1
    case 'done':
    default:
      return 2
  }
}

export function buildFloatingWidgetSnapshot(
  sessions: SessionWithState[],
  expanded: boolean
): FloatingWidgetSnapshot {
  const mappedSessions: FloatingWidgetSessionItem[] = sessions
    .filter((session) => session.providerId !== 'acp' && !session.isDraft)
    .map((session) => ({
      id: session.id,
      title: session.title.trim(),
      status: mapSessionStatus(session.status),
      updatedAt: session.updatedAt
    }))
    .sort((left, right) => {
      const statusDiff = getStatusPriority(left.status) - getStatusPriority(right.status)
      if (statusDiff !== 0) {
        return statusDiff
      }
      return right.updatedAt - left.updatedAt
    })

  const activeCount = mappedSessions.filter((session) => session.status === 'in_progress').length

  return {
    expanded,
    activeCount,
    sessions: mappedSessions
  }
}

export function inferDockSide(bounds: WidgetRect, workArea: WidgetRect): FloatingWidgetDockSide {
  const widgetCenterX = bounds.x + bounds.width / 2
  const workAreaCenterX = workArea.x + workArea.width / 2
  return widgetCenterX <= workAreaCenterX ? 'left' : 'right'
}

export function clampWidgetY(y: number, height: number, workArea: WidgetRect): number {
  return Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height))
}

export function getCollapsedWidgetSize(activeCount: number): Pick<WidgetRect, 'width' | 'height'> {
  return activeCount > 0
    ? { ...FLOATING_WIDGET_LAYOUT.collapsedBusy }
    : { ...FLOATING_WIDGET_LAYOUT.collapsedIdle }
}

export function getExpandedWidgetSize(sessionCount: number): Pick<WidgetRect, 'width' | 'height'> {
  const visibleSessions = Math.max(
    1,
    Math.min(sessionCount, FLOATING_WIDGET_LAYOUT.maxVisibleSessions)
  )
  const height = Math.min(
    FLOATING_WIDGET_LAYOUT.expandedMaxHeight,
    Math.max(
      FLOATING_WIDGET_LAYOUT.expandedMinHeight,
      FLOATING_WIDGET_LAYOUT.expandedHeaderHeight +
        visibleSessions * FLOATING_WIDGET_LAYOUT.expandedItemHeight +
        FLOATING_WIDGET_LAYOUT.expandedBottomPadding
    )
  )

  return {
    width: FLOATING_WIDGET_LAYOUT.expandedWidth,
    height
  }
}

export function getWidgetSizeForSnapshot(
  snapshot: FloatingWidgetSnapshot
): Pick<WidgetRect, 'width' | 'height'> {
  if (snapshot.expanded) {
    return getExpandedWidgetSize(snapshot.sessions.length)
  }
  return getCollapsedWidgetSize(snapshot.activeCount)
}

export function repositionWidgetForResize(
  currentBounds: WidgetRect,
  nextSize: Pick<WidgetRect, 'width' | 'height'>,
  workArea: WidgetRect,
  dockSide: FloatingWidgetDockSide
): WidgetRect {
  const rightEdge = currentBounds.x + currentBounds.width
  const nextX = dockSide === 'right' ? rightEdge - nextSize.width : currentBounds.x
  const clampedX = Math.max(
    workArea.x,
    Math.min(nextX, workArea.x + workArea.width - nextSize.width)
  )
  const nextY = clampWidgetY(currentBounds.y, nextSize.height, workArea)

  return {
    x: Math.round(clampedX),
    y: Math.round(nextY),
    width: nextSize.width,
    height: nextSize.height
  }
}

export function snapWidgetBoundsToEdge(
  bounds: WidgetRect,
  workArea: WidgetRect
): WidgetRect & { dockSide: FloatingWidgetDockSide } {
  const dockSide = inferDockSide(bounds, workArea)
  const x = dockSide === 'left' ? workArea.x : workArea.x + workArea.width - bounds.width
  const y = clampWidgetY(bounds.y, bounds.height, workArea)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: bounds.width,
    height: bounds.height,
    dockSide
  }
}
