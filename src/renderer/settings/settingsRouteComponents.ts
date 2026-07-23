export const settingsRouteComponents = {
  'settings-overview': () => import('./components/SettingsOverview.vue'),
  'settings-common': () => import('./components/CommonSettings.vue'),
  'settings-display': () => import('./components/DisplaySettings.vue'),
  'settings-environments': () => import('./components/EnvironmentsSettings.vue'),
  'settings-provider': () => import('./components/ModelProviderSettings.vue'),
  'settings-dashboard': () => import('./components/SettingsOverview.vue'),
  'settings-mcp': () => import('./components/McpSettings.vue'),
  'settings-ocr': () => import('./components/OcrSettings.vue'),
  'settings-deepchat-agents': () => import('./components/DeepChatAgentsSettings.vue'),
  'settings-acp': () => import('./components/AcpSettings.vue'),
  'settings-remote': () => import('./components/RemoteSettings.vue'),
  'settings-notifications-hooks': () => import('./components/NotificationsHooksSettings.vue'),
  'settings-scheduled-tasks': () => import('./components/CronJobsSettings.vue'),
  'settings-plugins': () => import('./components/PluginsSettings.vue'),
  'settings-skills': () => import('./components/skills/SkillsSettings.vue'),
  'settings-prompt': () => import('./components/PromptSetting.vue'),
  'settings-memory': () => import('./components/MemorySettings.vue'),
  'settings-knowledge-base': () => import('./components/KnowledgeBaseSettings.vue'),
  'settings-database': () => import('./components/DataSettings.vue'),
  'settings-shortcut': () => import('./components/ShortcutSettings.vue'),
  'settings-about': () => import('./components/AboutUsSettings.vue')
} as const

export function preloadSettingsRoute(routeName: string): Promise<unknown> | null {
  const loader = settingsRouteComponents[routeName as keyof typeof settingsRouteComponents]
  return loader?.() ?? null
}
