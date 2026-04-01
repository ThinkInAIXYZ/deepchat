export interface SettingsNavigationItem {
  routeName:
    | 'settings-common'
    | 'settings-display'
    | 'settings-environments'
    | 'settings-provider'
    | 'settings-dashboard'
    | 'settings-mcp'
    | 'settings-deepchat-agents'
    | 'settings-acp'
    | 'settings-remote'
    | 'settings-notifications-hooks'
    | 'settings-skills'
    | 'settings-prompt'
    | 'settings-knowledge-base'
    | 'settings-database'
    | 'settings-shortcut'
    | 'settings-about'
  path: string
  titleKey: string
  icon: string
  position: number
  keywords: string[]
}

export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
  {
    routeName: 'settings-common',
    path: '/common',
    titleKey: 'routes.settings-common',
    icon: 'lucide:bolt',
    position: 1,
    keywords: ['common', 'general', 'preferences', '通用', '设置']
  },
  {
    routeName: 'settings-display',
    path: '/display',
    titleKey: 'routes.settings-display',
    icon: 'lucide:monitor',
    position: 2,
    keywords: ['display', 'theme', 'font', 'appearance', '显示', '主题', '字体']
  },
  {
    routeName: 'settings-environments',
    path: '/environments',
    titleKey: 'routes.settings-environments',
    icon: 'lucide:folders',
    position: 2.5,
    keywords: ['environment', 'workspace', 'folder', 'project', '环境', '工作区', '目录']
  },
  {
    routeName: 'settings-provider',
    path: '/provider/:providerId?',
    titleKey: 'routes.settings-provider',
    icon: 'lucide:cloud-cog',
    position: 3,
    keywords: ['provider', 'model', 'llm', 'openai', 'anthropic', '服务商', '模型']
  },
  {
    routeName: 'settings-deepchat-agents',
    path: '/deepchat-agents',
    titleKey: 'routes.settings-deepchat-agents',
    icon: 'lucide:bot',
    position: 3.5,
    keywords: ['agent', 'agents', 'deepchat', '智能体', 'agent']
  },
  {
    routeName: 'settings-acp',
    path: '/acp',
    titleKey: 'routes.settings-acp',
    icon: 'lucide:shield-check',
    position: 4,
    keywords: ['acp', 'agent client protocol']
  },
  {
    routeName: 'settings-dashboard',
    path: '/dashboard',
    titleKey: 'routes.settings-dashboard',
    icon: 'lucide:layout-dashboard',
    position: 4.5,
    keywords: ['dashboard', 'usage', 'stats', '统计', '用量']
  },
  {
    routeName: 'settings-mcp',
    path: '/mcp',
    titleKey: 'routes.settings-mcp',
    icon: 'lucide:server',
    position: 5,
    keywords: ['mcp', 'tools', 'server', 'model context protocol', '工具', '服务']
  },
  {
    routeName: 'settings-remote',
    path: '/remote',
    titleKey: 'routes.settings-remote',
    icon: 'lucide:smartphone',
    position: 5.25,
    keywords: ['remote', 'telegram', 'feishu', 'control', '远程', '控制']
  },
  {
    routeName: 'settings-notifications-hooks',
    path: '/notifications-hooks',
    titleKey: 'routes.settings-notifications-hooks',
    icon: 'lucide:bell',
    position: 5.5,
    keywords: ['notification', 'hook', 'webhook', '通知']
  },
  {
    routeName: 'settings-skills',
    path: '/skills',
    titleKey: 'routes.settings-skills',
    icon: 'lucide:wand-sparkles',
    position: 6,
    keywords: ['skill', 'skills', '技能']
  },
  {
    routeName: 'settings-prompt',
    path: '/prompt',
    titleKey: 'routes.settings-prompt',
    icon: 'lucide:book-open-text',
    position: 7,
    keywords: ['prompt', 'system prompt', '提示词']
  },
  {
    routeName: 'settings-knowledge-base',
    path: '/knowledge-base',
    titleKey: 'routes.settings-knowledge-base',
    icon: 'lucide:book-marked',
    position: 8,
    keywords: ['knowledge', 'rag', 'knowledge base', '知识库']
  },
  {
    routeName: 'settings-database',
    path: '/database',
    titleKey: 'routes.settings-database',
    icon: 'lucide:database',
    position: 9,
    keywords: ['database', 'data', 'backup', '数据', '备份']
  },
  {
    routeName: 'settings-shortcut',
    path: '/shortcut',
    titleKey: 'routes.settings-shortcut',
    icon: 'lucide:keyboard',
    position: 10,
    keywords: ['shortcut', 'hotkey', 'keybinding', '快捷键']
  },
  {
    routeName: 'settings-about',
    path: '/about',
    titleKey: 'routes.settings-about',
    icon: 'lucide:info',
    position: 11,
    keywords: ['about', 'version', 'info', '关于', '版本']
  }
]
