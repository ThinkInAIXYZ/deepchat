/**
 * Event system constant definitions for Main Process -> Renderer Process
 * and Main Process -> Main Process communications.
 *
 * Event names follow a consistent naming convention:
 * - Use colon to separate domain and specific event.
 * - Use lowercase and hyphens for multiple words.
 */

// Configuration related events
export const CONFIG_EVENTS = {
  PROVIDER_CHANGED: 'config:provider-changed',
  SYSTEM_CHANGED: 'config:system-changed',
  MODEL_LIST_CHANGED: 'config:model-list-changed',
  MODEL_STATUS_CHANGED: 'config:model-status-changed',
  SETTING_CHANGED: 'config:setting-changed',
  PROXY_MODE_CHANGED: 'config:proxy-mode-changed',
  CUSTOM_PROXY_URL_CHANGED: 'config:custom-proxy-url-changed',
  ARTIFACTS_EFFECT_CHANGED: 'config:artifacts-effect-changed',
  SYNC_SETTINGS_CHANGED: 'config:sync-settings-changed',
  SEARCH_ENGINES_UPDATED: 'config:search-engines-updated',
  CONTENT_PROTECTION_CHANGED: 'config:content-protection-changed',
  PROXY_RESOLVED: 'config:proxy-resolved'
} as const; // Use 'as const' for type safety

// Conversation related events
export const CONVERSATION_EVENTS = {
  CREATED: 'conversation:created',
  ACTIVATED: 'conversation:activated',
  DEACTIVATED: 'conversation:deactivated',
  MESSAGE_EDITED: 'conversation:message-edited'
} as const; // Use 'as const' for type safety

// Communication/Stream related events
export const STREAM_EVENTS = {
  RESPONSE: 'stream:response',
  END: 'stream:end',
  ERROR: 'stream:error'
} as const; // Use 'as const' for type safety

// Application update related events
export const UPDATE_EVENTS = {
  STATUS_CHANGED: 'update:status-changed',
  ERROR: 'update:error',
  PROGRESS: 'update:progress', // Download progress
  WILL_RESTART: 'update:will-restart' // Preparing to restart
} as const; // Use 'as const' for type safety

// Window/App related events
export const WINDOW_EVENTS = {
  READY_TO_SHOW: 'window:ready-to-show',
  FORCE_QUIT_APP: 'window:force-quit-app',
  // Corrected for consistency with 'window:' prefix
  WINDOW_FOCUS: 'window:focus',
  WINDOW_BLUR: 'window:blur',
  WINDOW_MAXIMIZED: 'window:maximized',
  WINDOW_UNMAXIMIZED: 'window:unmaximized'
} as const; // Use 'as const' for type safety

// ollama related events
export const OLLAMA_EVENTS = {
  PULL_MODEL_PROGRESS: 'ollama:pull-model-progress'
} as const; // Use 'as const' for type safety

// MCP related events
export const MCP_EVENTS = {
  SERVER_STARTED: 'mcp:server-started',
  SERVER_STOPPED: 'mcp:server-stopped',
  CONFIG_CHANGED: 'mcp:config-changed',
  TOOL_CALL_RESULT: 'mcp:tool-call-result',
  SERVER_STATUS_CHANGED: 'mcp:server-status-changed',
  CLIENT_LIST_UPDATED: 'mcp:client-list-updated'
} as const; // Use 'as const' for type safety

// Sync related events
export const SYNC_EVENTS = {
  BACKUP_STARTED: 'sync:backup-started',
  BACKUP_COMPLETED: 'sync:backup-completed',
  BACKUP_ERROR: 'sync:backup-error',
  IMPORT_STARTED: 'sync:import-started',
  IMPORT_COMPLETED: 'sync:import-completed',
  IMPORT_ERROR: 'sync:import-error',
  DATA_CHANGED: 'sync:data-changed'
} as const; // Use 'as const' for type safety

// DeepLink related events
export const DEEPLINK_EVENTS = {
  PROTOCOL_RECEIVED: 'deeplink:protocol-received',
  START: 'deeplink:start',
  MCP_INSTALL: 'deeplink:mcp-install'
} as const; // Use 'as const' for type safety

// Global notification related events
export const NOTIFICATION_EVENTS = {
  SHOW_ERROR: 'notification:show-error', // Show error notification
  SYS_NOTIFY_CLICKED: 'notification:sys-notify-clicked' // System notification click event
} as const; // Use 'as const' for type safety

export const SHORTCUT_EVENTS = {
  ZOOM_IN: 'shortcut:zoom-in',
  ZOOM_OUT: 'shortcut:zoom-out',
  ZOOM_RESUME: 'shortcut:zoom-resume',
  CREATE_NEW_CONVERSATION: 'shortcut:create-new-conversation',
  GO_SETTINGS: 'shortcut:go-settings',
  CLEAN_CHAT_HISTORY: 'shortcut:clean-chat-history'
} as const; // Use 'as const' for type safety

// Example of how to create a union type of all event names (optional, but enhances type safety elsewhere)
/*
export type EventNames = typeof CONFIG_EVENTS[keyof typeof CONFIG_EVENTS]
  | typeof CONVERSATION_EVENTS[keyof typeof CONVERSATION_EVENTS]
  | typeof STREAM_EVENTS[keyof typeof STREAM_EVENTS]
  | typeof UPDATE_EVENTS[keyof typeof UPDATE_EVENTS]
  | typeof WINDOW_EVENTS[keyof typeof WINDOW_EVENTS]
  | typeof OLLAMA_EVENTS[keyof typeof OLLAMA_EVENTS]
  | typeof MCP_EVENTS[keyof typeof MCP_EVENTS]
  | typeof SYNC_EVENTS[keyof typeof SYNC_EVENTS]
  | typeof DEEPLINK_EVENTS[keyof typeof DEEPLINK_EVENTS]
  | typeof NOTIFICATION_EVENTS[keyof typeof NOTIFICATION_EVENTS]
  | typeof SHORTCUT_EVENTS[keyof typeof SHORTCUT_EVENTS];
*/
