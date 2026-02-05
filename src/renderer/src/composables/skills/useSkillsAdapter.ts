import { usePresenter } from '@/composables/usePresenter'
import { SKILL_EVENTS } from '@/events'
import type { SkillInstallResult, SkillMetadata } from '@shared/types/skill'

type SkillEventPayload = { conversationId: string; skills: string[] }

export function useSkillsAdapter() {
  const skillPresenter = usePresenter('skillPresenter')

  const subscribeSkillEvents = (handlers: {
    onActivated: (payload: SkillEventPayload) => void
    onDeactivated: (payload: SkillEventPayload) => void
  }) => {
    if (!window?.electron?.ipcRenderer) {
      return () => undefined
    }
    const activatedListener = (_event: unknown, payload: SkillEventPayload) => {
      handlers.onActivated(payload)
    }
    const deactivatedListener = (_event: unknown, payload: SkillEventPayload) => {
      handlers.onDeactivated(payload)
    }

    window.electron.ipcRenderer.on(SKILL_EVENTS.ACTIVATED, activatedListener)
    window.electron.ipcRenderer.on(SKILL_EVENTS.DEACTIVATED, deactivatedListener)

    return () => {
      window.electron.ipcRenderer.removeListener(SKILL_EVENTS.ACTIVATED, activatedListener)
      window.electron.ipcRenderer.removeListener(SKILL_EVENTS.DEACTIVATED, deactivatedListener)
    }
  }

  return {
    getMetadataList: (): Promise<SkillMetadata[]> => skillPresenter.getMetadataList(),
    installFromFolder: (
      folderPath: string,
      options?: { overwrite?: boolean }
    ): Promise<SkillInstallResult> => skillPresenter.installFromFolder(folderPath, options),
    installFromZip: (
      zipPath: string,
      options?: { overwrite?: boolean }
    ): Promise<SkillInstallResult> => skillPresenter.installFromZip(zipPath, options),
    installFromUrl: (url: string, options?: { overwrite?: boolean }): Promise<SkillInstallResult> =>
      skillPresenter.installFromUrl(url, options),
    uninstallSkill: (name: string): Promise<SkillInstallResult> =>
      skillPresenter.uninstallSkill(name),
    getSkillsDir: (): Promise<string> => skillPresenter.getSkillsDir(),
    openSkillsFolder: (): Promise<void> => skillPresenter.openSkillsFolder(),
    updateSkillFile: (name: string, content: string): Promise<SkillInstallResult> =>
      skillPresenter.updateSkillFile(name, content),
    getSkillFolderTree: (name: string) => skillPresenter.getSkillFolderTree(name),
    getActiveSkills: skillPresenter.getActiveSkills,
    setActiveSkills: skillPresenter.setActiveSkills,
    subscribeSkillEvents
  }
}
