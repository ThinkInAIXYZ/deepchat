export interface SettingsNavigationItem {
  routeName:
    | 'settings-overview'
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
    | 'settings-scheduled-tasks'
    | 'settings-plugins'
    | 'settings-skills'
    | 'settings-prompt'
    | 'settings-memory'
    | 'settings-knowledge-base'
    | 'settings-database'
    | 'settings-shortcut'
    | 'settings-about'
  path: string
  titleKey: string
  icon: string
  position: number
  groupKey: SettingsNavigationGroupKey
  keywords: string[]
  supportedPlatforms?: string[]
  supportedTargets?: string[]
  hiddenInSidebar?: boolean
}

export type SettingsNavigationGroupKey =
  | 'overview'
  | 'setup'
  | 'models'
  | 'tools'
  | 'knowledge'
  | 'system'

export interface SettingsNavigationGroup {
  key: SettingsNavigationGroupKey
  titleKey: string
  position: number
  items: SettingsNavigationItem[]
}

export interface SettingsNavigationPayload {
  routeName: SettingsNavigationItem['routeName']
  params?: Record<string, string>
  section?: string
}

export const SETTINGS_NAVIGATION_GROUPS: Array<Omit<SettingsNavigationGroup, 'items'>> = [
  {
    key: 'overview',
    titleKey: 'settings.controlCenter.groups.overview',
    position: 0
  },
  {
    key: 'setup',
    titleKey: 'settings.controlCenter.groups.setup',
    position: 1
  },
  {
    key: 'models',
    titleKey: 'settings.controlCenter.groups.models',
    position: 2
  },
  {
    key: 'tools',
    titleKey: 'settings.controlCenter.groups.tools',
    position: 3
  },
  {
    key: 'knowledge',
    titleKey: 'settings.controlCenter.groups.knowledge',
    position: 4
  },
  {
    key: 'system',
    titleKey: 'settings.controlCenter.groups.system',
    position: 5
  }
]

export const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
  {
    routeName: 'settings-overview',
    path: '/overview',
    titleKey: 'routes.settings-overview',
    icon: 'lucide:gauge',
    position: 0,
    groupKey: 'overview',
    keywords: ['overview', 'dashboard', 'usage', 'settings', '控制台', '设置中心', '用量']
  },
  {
    routeName: 'settings-common',
    path: '/common',
    titleKey: 'routes.settings-common',
    icon: 'lucide:bolt',
    position: 1,
    groupKey: 'setup',
    keywords: ['common', 'general', 'preferences', '通用', '设置']
  },
  {
    routeName: 'settings-display',
    path: '/display',
    titleKey: 'routes.settings-display',
    icon: 'lucide:monitor',
    position: 2,
    groupKey: 'setup',
    keywords: ['display', 'theme', 'font', 'appearance', '显示', '主题', '字体']
  },
  {
    routeName: 'settings-environments',
    path: '/environments',
    titleKey: 'routes.settings-environments',
    icon: 'lucide:folders',
    position: 3.25,
    groupKey: 'models',
    keywords: ['environment', 'workspace', 'folder', 'project', '环境', '工作区', '目录']
  },
  {
    routeName: 'settings-provider',
    path: '/provider/:providerId?',
    titleKey: 'routes.settings-provider',
    icon: 'lucide:cloud-cog',
    position: 3,
    groupKey: 'models',
    keywords: ['provider', 'model', 'llm', 'openai', 'anthropic', '服务商', '模型']
  },
  {
    routeName: 'settings-deepchat-agents',
    path: '/deepchat-agents',
    titleKey: 'routes.settings-deepchat-agents',
    icon: 'lucide:bot',
    position: 3.5,
    groupKey: 'models',
    keywords: ['agent', 'agents', 'deepchat', '智能体', 'agent']
  },
  {
    routeName: 'settings-acp',
    path: '/acp',
    titleKey: 'routes.settings-acp',
    icon: 'lucide:shield-check',
    position: 4,
    groupKey: 'models',
    keywords: ['acp', 'agent client protocol']
  },
  {
    routeName: 'settings-dashboard',
    path: '/dashboard',
    titleKey: 'routes.settings-dashboard',
    icon: 'lucide:layout-dashboard',
    position: 4.5,
    groupKey: 'overview',
    keywords: ['dashboard', 'usage', 'stats', '统计', '用量'],
    hiddenInSidebar: true
  },
  {
    routeName: 'settings-mcp',
    path: '/mcp',
    titleKey: 'routes.settings-mcp',
    icon: 'lucide:server',
    position: 5,
    groupKey: 'tools',
    keywords: ['mcp', 'tools', 'server', 'model context protocol', '工具', '服务'],
    hiddenInSidebar: true
  },
  {
    routeName: 'settings-remote',
    path: '/remote',
    titleKey: 'routes.settings-remote',
    icon: 'lucide:smartphone',
    position: 5.25,
    groupKey: 'system',
    keywords: ['remote', 'telegram', 'feishu', 'control', '远程', '控制'],
    hiddenInSidebar: true
  },
  {
    routeName: 'settings-notifications-hooks',
    path: '/notifications-hooks',
    titleKey: 'routes.settings-notifications-hooks',
    icon: 'lucide:bell',
    position: 5.5,
    groupKey: 'tools',
    keywords: ['notification', 'hook', 'webhook', '通知']
  },
  {
    routeName: 'settings-scheduled-tasks',
    path: '/scheduled-tasks',
    titleKey: 'routes.settings-scheduled-tasks',
    icon: 'lucide:clock-9',
    position: 5.6,
    groupKey: 'tools',
    keywords: [
      'schedule',
      'scheduled',
      'reminder',
      'timer',
      'cron',
      '定时',
      '提醒',
      '计划',
      '定时任务'
    ]
  },
  {
    routeName: 'settings-plugins',
    path: '/plugins',
    titleKey: 'routes.settings-plugins',
    icon: 'lucide:puzzle',
    position: 5.75,
    groupKey: 'tools',
    keywords: ['plugin', 'plugins', 'extension', 'runtime', '插件', '扩展', '运行时'],
    supportedTargets: ['darwin/arm64', 'darwin/x64', 'win32/x64', 'win32/arm64', 'linux/x64'],
    hiddenInSidebar: true
  },
  {
    routeName: 'settings-skills',
    path: '/skills',
    titleKey: 'routes.settings-skills',
    icon: 'lucide:wand-sparkles',
    position: 6,
    groupKey: 'knowledge',
    keywords: ['skill', 'skills', '技能'],
    hiddenInSidebar: true
  },
  {
    routeName: 'settings-prompt',
    path: '/prompt',
    titleKey: 'routes.settings-prompt',
    icon: 'lucide:book-open-text',
    position: 7,
    groupKey: 'knowledge',
    keywords: ['prompt', 'system prompt', '提示词']
  },
  {
    routeName: 'settings-memory',
    path: '/memory',
    titleKey: 'routes.settings-memory',
    icon: 'lucide:brain',
    position: 7.5,
    groupKey: 'knowledge',
    keywords: ['memory', 'memories', 'persona', 'recall', '记忆', '长期记忆', '人格']
  },
  {
    routeName: 'settings-knowledge-base',
    path: '/knowledge-base',
    titleKey: 'routes.settings-knowledge-base',
    icon: 'lucide:book-marked',
    position: 8,
    groupKey: 'knowledge',
    keywords: ['knowledge', 'rag', 'knowledge base', '知识库']
  },
  {
    routeName: 'settings-database',
    path: '/database',
    titleKey: 'routes.settings-database',
    icon: 'lucide:database',
    position: 9,
    groupKey: 'system',
    keywords: ['database', 'data', 'backup', '数据', '备份']
  },
  {
    routeName: 'settings-shortcut',
    path: '/shortcut',
    titleKey: 'routes.settings-shortcut',
    icon: 'lucide:keyboard',
    position: 10,
    groupKey: 'system',
    keywords: ['shortcut', 'hotkey', 'keybinding', '快捷键']
  },
  {
    routeName: 'settings-about',
    path: '/about',
    titleKey: 'routes.settings-about',
    icon: 'lucide:info',
    position: 11,
    groupKey: 'system',
    keywords: ['about', 'version', 'info', '关于', '版本']
  }
]

const getPlatformAliases = (platform?: string): Set<string> => {
  const normalized = platform?.trim().toLowerCase()
  if (!normalized) {
    return new Set()
  }

  if (['darwin', 'macos', 'mac'].includes(normalized)) {
    return new Set(['darwin', 'macos', 'mac'])
  }
  if (['win32', 'windows', 'win'].includes(normalized)) {
    return new Set(['win32', 'windows', 'win'])
  }

  return new Set([normalized])
}

export const isSettingsNavigationItemSupported = (
  item: SettingsNavigationItem,
  platform?: string,
  arch?: string
): boolean => {
  if (item.supportedTargets?.length) {
    if (!platform || !arch) {
      return true
    }
    const normalizedArch = arch.trim().toLowerCase()
    const aliases = getPlatformAliases(platform)
    const targets = item.supportedTargets.map((target) => target.trim().toLowerCase())
    return [...aliases].some((platformAlias) =>
      targets.includes(`${platformAlias}/${normalizedArch}`)
    )
  }

  if (!item.supportedPlatforms?.length) {
    return true
  }
  if (!platform) {
    return true
  }

  const aliases = getPlatformAliases(platform)
  return item.supportedPlatforms.some((supportedPlatform) =>
    aliases.has(supportedPlatform.trim().toLowerCase())
  )
}

export const getSettingsRouteItems = (platform?: string, arch?: string): SettingsNavigationItem[] =>
  SETTINGS_NAVIGATION_ITEMS.filter((item) =>
    isSettingsNavigationItemSupported(item, platform, arch)
  )

export const getSettingsNavigationItems = (
  platform?: string,
  arch?: string
): SettingsNavigationItem[] =>
  getSettingsRouteItems(platform, arch).filter((item) => !item.hiddenInSidebar)

export const getSettingsNavigationGroups = (
  platform?: string,
  arch?: string
): SettingsNavigationGroup[] => {
  const items = getSettingsNavigationItems(platform, arch)

  return SETTINGS_NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: items
      .filter((item) => item.groupKey === group.key)
      .sort((left, right) => left.position - right.position)
  })).filter((group) => group.items.length > 0)
}

export const resolveSettingsNavigationPath = (
  routeName: SettingsNavigationItem['routeName'],
  params?: Record<string, string>,
  platform?: string,
  arch?: string
): string => {
  const item = getSettingsRouteItems(platform, arch).find(
    (navigationItem) => navigationItem.routeName === routeName
  )
  if (!item) {
    return '/overview'
  }

  const resolvedSegments = item.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => {
      if (!segment.startsWith(':')) {
        return [segment]
      }

      const key = segment.slice(1).replace(/\?$/, '')
      const value = params?.[key]?.trim()
      if (value) {
        return [encodeURIComponent(value)]
      }

      return segment.endsWith('?') ? [] : [key]
    })

  return `/${resolvedSegments.join('/')}`
}
