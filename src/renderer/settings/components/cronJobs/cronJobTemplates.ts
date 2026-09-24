/**
 * Starter templates offered from the scheduled-tasks empty state. Selecting one
 * prefills the create form; nothing is persisted until the user confirms.
 */
export interface CronJobTemplate {
  id: 'dailyDigest' | 'repositoryDigest' | 'knowledgeTidy'
  nameKey: string
  promptKey: string
  cronExpr: string
  icon: string
}

export const CRON_JOB_TEMPLATES: readonly CronJobTemplate[] = [
  {
    id: 'dailyDigest',
    nameKey: 'settings.cronJobs.templates.dailyDigest.name',
    promptKey: 'settings.cronJobs.templates.dailyDigest.prompt',
    cronExpr: '0 9 * * *',
    icon: 'lucide:newspaper'
  },
  {
    id: 'repositoryDigest',
    nameKey: 'settings.cronJobs.templates.repositoryDigest.name',
    promptKey: 'settings.cronJobs.templates.repositoryDigest.prompt',
    cronExpr: '0 9 * * 1',
    icon: 'lucide:git-pull-request'
  },
  {
    id: 'knowledgeTidy',
    nameKey: 'settings.cronJobs.templates.knowledgeTidy.name',
    promptKey: 'settings.cronJobs.templates.knowledgeTidy.prompt',
    cronExpr: '0 18 * * 5',
    icon: 'lucide:library'
  }
] as const
