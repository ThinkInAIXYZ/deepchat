export const SESSION_EVENTS = {
  SESSION_CREATED: 'session:created',
  SESSION_DELETED: 'session:deleted',
  SESSION_UPDATED: 'session:updated',
  SESSION_ACTIVATED: 'session:activated',
  SESSION_DEACTIVATED: 'session:deactivated',
  SESSION_RENAMED: 'session:renamed',
  SESSION_PINNED: 'session:pinned',
  LIST_UPDATED: 'session:list-updated'
} as const

export type SessionEventType = (typeof SESSION_EVENTS)[keyof typeof SESSION_EVENTS]
