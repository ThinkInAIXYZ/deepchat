export type * from './types'

// Re-export from new ACP architecture
export { buildClientCapabilities, type AcpCapabilityOptions } from '../../acpPresenter/capabilities'
export { AcpContentMapper, type AcpCommand } from '../../acpPresenter/mappers/contentMapper'
export { AcpFsHandler } from '../../acpPresenter/handlers/fsHandler'
export { AcpTerminalManager } from '../../acpPresenter/handlers/terminalManager'
export {
  AcpProcessManager,
  type AcpProcessHandle,
  type SessionNotificationHandler,
  type PermissionResolver
} from '../../acpPresenter/managers/processManager'
export { AcpSessionManager } from '../../acpPresenter/managers/sessionManager'
export type { AcpSessionRecord } from '../../acpPresenter/types'
export { getShellEnvironment, clearShellEnvironmentCache } from '@/lib/shellEnvHelper'
export { convertMcpConfigToAcpFormat } from '../../acpPresenter/helpers/mcpConfigConverter'
export { filterMcpServersByTransportSupport } from '../../acpPresenter/helpers/mcpTransportFilter'

// Export Agent tools (now in tools/ directory)
export { AgentFileSystemHandler } from '../tools/fileSystemHandler'
export { AgentToolManager, type AgentToolCallResult } from '../tools/toolManager'
export { AgentBashHandler } from '../tools/bashHandler'
export {
  registerCommandProcess,
  unregisterCommandProcess,
  terminateCommandProcess
} from '../tools/commandProcessTracker'
