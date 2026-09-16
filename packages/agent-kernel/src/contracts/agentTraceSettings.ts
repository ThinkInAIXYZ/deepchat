/**
 * Trace diagnostics surface the built-in kernel needs. Declared here so kernel modules depend on
 * this structural port instead of the Desktop settings service; the host class implements it.
 */
export interface AgentTraceSettingsPort {
  isEnabled(): boolean
  setEnabled(enabled: boolean): void
}
