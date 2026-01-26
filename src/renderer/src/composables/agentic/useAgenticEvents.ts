/**
 * useAgenticEvents - Type-Safe Agentic Event Subscription
 *
 * Provides type-safe subscription to AgenticEventType events.
 * Handles event listener registration and automatic cleanup.
 *
 * @example
 * ```ts
 * const { onSessionUpdated, onMessageDelta, cleanup } = useAgenticEvents()
 *
 * onSessionUpdated((payload) => {
 *   console.log('Session updated:', payload.sessionId)
 * })
 *
 * onUnmounted(() => cleanup())
 * ```
 */
import type {
  SessionCreatedEvent,
  SessionReadyEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  MessageDeltaEvent,
  MessageBlockEvent,
  MessageEndEvent,
  ToolStartEvent,
  ToolRunningEvent,
  ToolEndEvent,
  StatusChangedEvent,
  AgenticErrorEvent,
  ToolPermissionRequiredEvent,
  ToolPermissionGrantedEvent,
  ToolPermissionDeniedEvent
} from '@shared/types/presenters/agentic.presenter.d'
import { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

// Event payload types mapping
type EventPayloads = {
  [AgenticEventType.SESSION_CREATED]: SessionCreatedEvent
  [AgenticEventType.SESSION_READY]: SessionReadyEvent
  [AgenticEventType.SESSION_UPDATED]: SessionUpdatedEvent
  [AgenticEventType.SESSION_CLOSED]: SessionClosedEvent
  [AgenticEventType.MESSAGE_DELTA]: MessageDeltaEvent
  [AgenticEventType.MESSAGE_BLOCK]: MessageBlockEvent
  [AgenticEventType.MESSAGE_END]: MessageEndEvent
  [AgenticEventType.TOOL_START]: ToolStartEvent
  [AgenticEventType.TOOL_RUNNING]: ToolRunningEvent
  [AgenticEventType.TOOL_END]: ToolEndEvent
  [AgenticEventType.STATUS_CHANGED]: StatusChangedEvent
  [AgenticEventType.ERROR]: AgenticErrorEvent
  [AgenticEventType.TOOL_PERMISSION_REQUIRED]: ToolPermissionRequiredEvent
  [AgenticEventType.TOOL_PERMISSION_GRANTED]: ToolPermissionGrantedEvent
  [AgenticEventType.TOOL_PERMISSION_DENIED]: ToolPermissionDeniedEvent
}

// Event handler type
type EventHandler<T extends AgenticEventType> = (payload: EventPayloads[T]) => void

// Store all active listeners for cleanup
const activeListeners = new Map<AgenticEventType, Set<EventHandler<AgenticEventType>>>()

/**
 * Internal wrapper for event handlers to match IPC event signature
 */
function createIpcHandler<T extends AgenticEventType>(
  handler: EventHandler<T>
): (_event: unknown, payload: EventPayloads[T]) => void {
  return (_event, payload) => handler(payload)
}

export function useAgenticEvents() {
  /**
   * Subscribe to an agentic event with type safety
   * @param eventType - The AgenticEventType to subscribe to
   * @param handler - The handler function to call when event is emitted
   */
  function on<T extends AgenticEventType>(eventType: T, handler: EventHandler<T>): () => void {
    // Get or create listener set for this event type
    let listeners = activeListeners.get(eventType)
    if (!listeners) {
      listeners = new Set()
      activeListeners.set(eventType, listeners)
    }

    // Create IPC handler wrapper
    const ipcHandler = createIpcHandler(handler)

    // Register with electron IPC
    window.electron.ipcRenderer.on(eventType, ipcHandler)

    // Store handler for cleanup
    listeners.add(handler as EventHandler<AgenticEventType>)

    // Return unsubscribe function
    return () => {
      off(eventType, handler)
    }
  }

  /**
   * Unsubscribe from an agentic event
   * @param eventType - The AgenticEventType to unsubscribe from
   * @param handler - The handler function to remove
   */
  function off<T extends AgenticEventType>(eventType: T, handler: EventHandler<T>): void {
    const listeners = activeListeners.get(eventType)
    if (listeners && listeners.has(handler as EventHandler<AgenticEventType>)) {
      const ipcHandler = createIpcHandler(handler)
      window.electron.ipcRenderer.removeListener(eventType, ipcHandler)
      listeners.delete(handler as EventHandler<AgenticEventType>)

      // Clean up empty listener sets
      if (listeners.size === 0) {
        activeListeners.delete(eventType)
      }
    }
  }

  /**
   * Subscribe to session created event
   */
  function onSessionCreated(handler: (payload: SessionCreatedEvent) => void): () => void {
    return on(AgenticEventType.SESSION_CREATED, handler)
  }

  /**
   * Subscribe to session ready event
   */
  function onSessionReady(handler: (payload: SessionReadyEvent) => void): () => void {
    return on(AgenticEventType.SESSION_READY, handler)
  }

  /**
   * Subscribe to session updated event
   */
  function onSessionUpdated(handler: (payload: SessionUpdatedEvent) => void): () => void {
    return on(AgenticEventType.SESSION_UPDATED, handler)
  }

  /**
   * Subscribe to session closed event
   */
  function onSessionClosed(handler: (payload: SessionClosedEvent) => void): () => void {
    return on(AgenticEventType.SESSION_CLOSED, handler)
  }

  /**
   * Subscribe to message delta event
   */
  function onMessageDelta(handler: (payload: MessageDeltaEvent) => void): () => void {
    return on(AgenticEventType.MESSAGE_DELTA, handler)
  }

  /**
   * Subscribe to message block event
   */
  function onMessageBlock(handler: (payload: MessageBlockEvent) => void): () => void {
    return on(AgenticEventType.MESSAGE_BLOCK, handler)
  }

  /**
   * Subscribe to message end event
   */
  function onMessageEnd(handler: (payload: MessageEndEvent) => void): () => void {
    return on(AgenticEventType.MESSAGE_END, handler)
  }

  /**
   * Subscribe to tool start event
   */
  function onToolStart(handler: (payload: ToolStartEvent) => void): () => void {
    return on(AgenticEventType.TOOL_START, handler)
  }

  /**
   * Subscribe to tool running event
   */
  function onToolRunning(handler: (payload: ToolRunningEvent) => void): () => void {
    return on(AgenticEventType.TOOL_RUNNING, handler)
  }

  /**
   * Subscribe to tool end event
   */
  function onToolEnd(handler: (payload: ToolEndEvent) => void): () => void {
    return on(AgenticEventType.TOOL_END, handler)
  }

  /**
   * Subscribe to tool permission required event
   */
  function onToolPermissionRequired(
    handler: (payload: ToolPermissionRequiredEvent) => void
  ): () => void {
    return on(AgenticEventType.TOOL_PERMISSION_REQUIRED, handler)
  }

  /**
   * Subscribe to tool permission granted event
   */
  function onToolPermissionGranted(
    handler: (payload: ToolPermissionGrantedEvent) => void
  ): () => void {
    return on(AgenticEventType.TOOL_PERMISSION_GRANTED, handler)
  }

  /**
   * Subscribe to tool permission denied event
   */
  function onToolPermissionDenied(
    handler: (payload: ToolPermissionDeniedEvent) => void
  ): () => void {
    return on(AgenticEventType.TOOL_PERMISSION_DENIED, handler)
  }

  /**
   * Subscribe to status changed event
   */
  function onStatusChanged(handler: (payload: StatusChangedEvent) => void): () => void {
    return on(AgenticEventType.STATUS_CHANGED, handler)
  }

  /**
   * Subscribe to error event
   */
  function onError(handler: (payload: AgenticErrorEvent) => void): () => void {
    return on(AgenticEventType.ERROR, handler)
  }

  /**
   * Clean up all event listeners registered by this composable instance
   */
  function cleanup(): void {
    activeListeners.forEach((listeners, eventType) => {
      listeners.forEach((handler) => {
        off(eventType, handler)
      })
    })
    activeListeners.clear()
  }

  return {
    // Generic on/off
    on,
    off,

    // Type-safe event subscriptions
    onSessionCreated,
    onSessionReady,
    onSessionUpdated,
    onSessionClosed,
    onMessageDelta,
    onMessageBlock,
    onMessageEnd,
    onToolStart,
    onToolRunning,
    onToolEnd,
    onToolPermissionRequired,
    onToolPermissionGranted,
    onToolPermissionDenied,
    onStatusChanged,
    onError,

    // Cleanup
    cleanup
  }
}

export type UseAgenticEventsReturn = ReturnType<typeof useAgenticEvents>
