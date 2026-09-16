/**
 * Default system prompt surface the built-in kernel needs. Declared here so kernel modules depend
 * on this structural port instead of the Desktop prompt settings service; the host class
 * implements it.
 */
export interface PromptSettingsPort {
  getDefaultSystemPrompt(): Promise<string>
}
