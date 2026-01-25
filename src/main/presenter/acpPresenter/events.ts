/**
 * ACP (Agent Client Protocol) Event Definitions
 *
 * These events are specific to the ACP module and should be used
 * only within the ACP presenter and its related components.
 */

// ACP-specific workspace events
export const ACP_WORKSPACE_EVENTS = {
  SESSION_MODES_READY: 'acp-workspace:session-modes-ready', // Session modes available
  SESSION_MODELS_READY: 'acp-workspace:session-models-ready', // Session models available
  COMMANDS_UPDATE: 'acp-workspace:commands-update' // Available commands updated
}

export const ACP_DEBUG_EVENTS = {
  EVENT: 'acp-debug:event'
}

// ACP independent event system (new architecture)
export const ACP_EVENTS = {
  // Session lifecycle
  SESSION_CREATED: 'acp:session-created',
  SESSION_LOADED: 'acp:session-loaded',
  SESSION_CLOSED: 'acp:session-closed',
  SESSION_FAILED: 'acp:session-failed',

  // Message flow
  PROMPT_STARTED: 'acp:prompt-started',
  SESSION_UPDATE: 'acp:session-update', // Agent returned content update
  PROMPT_COMPLETED: 'acp:prompt-completed',
  PROMPT_CANCELLED: 'acp:prompt-cancelled',
  PROMPT_TIMEOUT: 'acp:prompt-timeout',

  // Permission requests
  PERMISSION_REQUEST: 'acp:permission-request',
  PERMISSION_RESOLVED: 'acp:permission-resolved',

  // Mode/Model changes
  MODE_CHANGED: 'acp:mode-changed',
  MODEL_CHANGED: 'acp:model-changed',
  COMMANDS_UPDATE: 'acp:commands-update',

  // Process management
  PROCESS_STARTED: 'acp:process-started',
  PROCESS_READY: 'acp:process-ready',
  PROCESS_CRASHED: 'acp:process-crashed',
  PROCESS_STOPPED: 'acp:process-stopped',

  // Errors
  ERROR: 'acp:error'
}
