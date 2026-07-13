import path from 'path'
import type { WatcherEvent } from './watcherTypes'

const normalizeEventKey = (filePath: string): string => {
  const comparablePath =
    process.platform === 'darwin' && filePath.startsWith('/private/')
      ? filePath.slice('/private'.length)
      : filePath
  const normalized = path.normalize(comparablePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const isDescendantOf = (candidate: string, parent: string): boolean => {
  const relative = path.relative(parent, candidate)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function mergeEvent(previous: WatcherEvent, next: WatcherEvent): WatcherEvent | null {
  if (previous.type === 'create' && next.type === 'delete') {
    return null
  }

  if (previous.type === 'delete' && next.type === 'create') {
    return {
      path: next.path,
      type: 'update'
    }
  }

  if (previous.type === 'create' && next.type === 'update') {
    return previous
  }

  return next
}

export function coalesceWatcherEvents(events: WatcherEvent[]): WatcherEvent[] {
  const byPath = new Map<string, WatcherEvent>()

  for (const event of events) {
    const key = normalizeEventKey(event.path)
    const previous = byPath.get(key)
    if (!previous) {
      byPath.set(key, event)
      continue
    }

    const merged = mergeEvent(previous, event)
    if (merged) {
      byPath.set(key, merged)
    } else {
      byPath.delete(key)
    }
  }

  const mergedEvents = Array.from(byPath.values())
  const deletedParents = mergedEvents
    .filter((event) => event.type === 'delete')
    .map((event) => normalizeEventKey(event.path))

  return mergedEvents.filter((event) => {
    if (event.type !== 'delete') {
      return true
    }

    const normalized = normalizeEventKey(event.path)
    return !deletedParents.some(
      (deletedParent) => deletedParent !== normalized && isDescendantOf(normalized, deletedParent)
    )
  })
}
