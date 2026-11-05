import type { SessionListItem, SessionRecord } from '@shared/types/agent-interface'

/**
 * Projects a stored session row into the list item the renderer consumes.
 *
 * Kept as one function so every reader — the Electron main process and the Node
 * sidecar — maps the same row the same way. `status` comes from the live runtime
 * and is `idle` when the session is not hydrated.
 */
export function toSessionListItem(
  record: SessionRecord,
  status: SessionListItem['status']
): SessionListItem {
  return { ...record, status }
}
