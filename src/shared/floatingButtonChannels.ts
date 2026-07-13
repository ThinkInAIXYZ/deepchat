export const FLOATING_BUTTON_EVENTS = {
  CLICKED: 'floating-button:clicked',
  RIGHT_CLICKED: 'floating-button:right-clicked',
  VISIBILITY_CHANGED: 'floating-button:visibility-changed',
  POSITION_CHANGED: 'floating-button:position-changed',
  ENABLED_CHANGED: 'floating-button:enabled-changed',
  HOVER_STATE_CHANGED: 'floating-button:hover-state-changed',
  SNAPSHOT_REQUEST: 'floating-button:snapshot-request',
  SNAPSHOT_UPDATED: 'floating-button:snapshot-updated',
  LANGUAGE_REQUEST: 'floating-button:language-request',
  LANGUAGE_CHANGED: 'floating-button:language-changed',
  THEME_REQUEST: 'floating-button:theme-request',
  THEME_CHANGED: 'floating-button:theme-changed',
  ACP_REGISTRY_ICON_REQUEST: 'floating-button:acp-registry-icon-request',
  TOGGLE_EXPANDED: 'floating-button:toggle-expanded',
  SET_EXPANDED: 'floating-button:set-expanded',
  OPEN_SESSION: 'floating-button:open-session',
  DRAG_START: 'floating-button:drag-start',
  DRAG_MOVE: 'floating-button:drag-move',
  DRAG_END: 'floating-button:drag-end'
} as const

export type FloatingButtonEventName =
  (typeof FLOATING_BUTTON_EVENTS)[keyof typeof FLOATING_BUTTON_EVENTS]
