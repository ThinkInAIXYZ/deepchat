/**
 * Agentic Composables - Phase 1 & 5
 *
 * New composables for unified agentic presenter integration.
 * These composables work alongside existing ones (no breaking changes).
 *
 * Phase 1 composables:
 * - useAgenticSession: Reactive SessionInfo access
 * - useAgenticEvents: Type-safe event subscription
 * - useAgenticAdapter: Message execution & agent discovery
 * - useAgenticSessionStore: Unified session state management
 * - useSessionConfig: SessionInfo-driven configuration
 * - useSessionExport: sessionId-based export
 *
 * Phase 5 composables:
 * - useSessionManagement: Session lifecycle management
 * - useAgenticExecution: Message execution with state management
 */

// Export individual composables
export { useAgenticSession } from './useAgenticSession'
export { useAgenticEvents } from './useAgenticEvents'
export { useAgenticAdapter } from './useAgenticAdapter'
export { useAgenticSessionStore } from './useAgenticSessionStore'
export { useSessionConfig } from './useSessionConfig'
export { useSessionExport } from './useSessionExport'
export { useSessionManagement } from './useSessionManagement'
export { useAgenticExecution } from './useAgenticExecution'

// Export types
export type { UseAgenticSessionReturn } from './useAgenticSession'
export type { UseAgenticEventsReturn } from './useAgenticEvents'
export type { AgenticAdapter, AgentInfo } from './useAgenticAdapter'
export type { UseAgenticAdapterReturn } from './useAgenticAdapter'
export type { UseAgenticSessionStoreReturn } from './useAgenticSessionStore'
export type { UseSessionConfigReturn } from './useSessionConfig'
export type {
  UseSessionExportReturn,
  ExportFormat,
  ExportResult,
  ExportOptions
} from './useSessionExport'
export type { UseSessionManagementReturn } from './useSessionManagement'
export type { UseAgenticExecutionReturn } from './useAgenticExecution'
