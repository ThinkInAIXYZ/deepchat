import { usePresenter } from '@/composables/usePresenter'
import { SKILL_EVENTS } from '@/events'

type SkillEventPayload = { conversationId: string; skills: string[] }

export function useSkillsAdapter() {
  const skillPresenter = usePresenter('skillPresenter')

  const subscribeSkillEvents = (handlers: {
    onActivated: (payload: SkillEventPayload) => void
    onDeactivated: (payload: SkillEventPayload) => void
  }) => {
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
    getActiveSkills: skillPresenter.getActiveSkills,
    setActiveSkills: skillPresenter.setActiveSkills,
    subscribeSkillEvents
  }
}
