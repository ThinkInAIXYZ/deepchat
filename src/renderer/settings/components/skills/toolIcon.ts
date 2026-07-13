const TOOL_ICONS: Record<string, string> = {
  agents: 'lucide:bot',
  'claude-code': 'simple-icons:anthropic',
  cursor: 'simple-icons:cursor',
  'cursor-project': 'simple-icons:cursor',
  windsurf: 'lucide:wind',
  copilot: 'simple-icons:github',
  'copilot-user': 'simple-icons:github',
  kiro: 'lucide:sparkles',
  antigravity: 'lucide:rocket',
  codex: 'simple-icons:openai',
  opencode: 'lucide:code-2',
  goose: 'lucide:bird',
  kilocode: 'lucide:binary'
}

const TOOL_ICON_BACKGROUNDS: Record<string, string> = {
  agents: 'bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400',
  'claude-code': 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  cursor: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  'cursor-project': 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  windsurf: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
  copilot: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  'copilot-user': 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  kiro: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
  antigravity: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  codex: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  opencode: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  goose: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  kilocode: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
}

export const getSkillAgentIcon = (toolId: string): string => TOOL_ICONS[toolId] || 'lucide:bot'

export const getSkillToolIcon = (toolId: string): string => TOOL_ICONS[toolId] || 'lucide:box'

export const getSkillToolIconBg = (toolId: string): string =>
  TOOL_ICON_BACKGROUNDS[toolId] ||
  'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
