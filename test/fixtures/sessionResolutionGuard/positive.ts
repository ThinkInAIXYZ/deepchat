import type { IAgentSessionPresenter as FullPort } from '../../../src/shared/types/presenters/agent-session.presenter'

declare const presenter: { agentSessionPresenter: FullPort }

export function directReference(): Promise<unknown> {
  return presenter.agentSessionPresenter.getSession('session-1')
}

export function aliasedReference(): Promise<unknown> {
  const sessionPresenter = presenter.agentSessionPresenter as Pick<FullPort, 'getSessionList'>
  const alias = sessionPresenter
  return alias.getSessionList()
}

export function destructuredReference(): Promise<unknown> | undefined {
  const sessionPresenter = presenter.agentSessionPresenter as Partial<
    Pick<FullPort, 'getActiveSession'>
  >
  const { getActiveSession } = sessionPresenter
  return getActiveSession?.(1)
}

export function boundReference(): (sessionId: string) => Promise<unknown> {
  const sessionPresenter = presenter.agentSessionPresenter as Pick<FullPort, 'getSession'>
  return sessionPresenter.getSession.bind(sessionPresenter)
}

export function destructuredRootReference(): Promise<unknown> {
  const { agentSessionPresenter } = presenter
  return agentSessionPresenter.getSession('session-1')
}

export function typedReference(sessionPresenter: FullPort): Promise<unknown> {
  return sessionPresenter.getSessionList()
}

export function pickReference(sessionPresenter: Pick<FullPort, 'getSession'>): Promise<unknown> {
  return sessionPresenter.getSession('session-1')
}

export function constrainedTypeParameterReference<T extends Pick<FullPort, 'getSession'>>(
  sessionPresenter: T
): Promise<unknown> {
  return sessionPresenter.getSession('session-1')
}

export function parameterDestructuredReference({
  getSession
}: Pick<FullPort, 'getSession'>): Promise<unknown> {
  return getSession('session-1')
}

export function parameterRestReference({ ...sessionPresenter }: FullPort): Promise<unknown> {
  return sessionPresenter.getSession('session-1')
}

export function variableRestReference(): Promise<unknown> {
  const { ...sessionPresenter } = presenter.agentSessionPresenter
  return sessionPresenter.getSession('session-1')
}

export function assignmentDestructuredReference(): Promise<unknown> {
  let getSession: FullPort['getSession']
  ;({ getSession } = presenter.agentSessionPresenter)
  return getSession('session-1')
}

export function assignmentRestReference(): Promise<unknown> {
  let sessionPresenter
  ;({ ...sessionPresenter } = presenter.agentSessionPresenter)
  return (sessionPresenter as any).getSession('session-1')
}

type SessionListPort = Partial<Pick<FullPort, 'getSessionList'>>

export function typeAliasReference(
  sessionPresenter: SessionListPort
): Promise<unknown> | undefined {
  return sessionPresenter.getSessionList?.()
}

export function typedAssignmentReference(): Promise<unknown> {
  let first: Pick<FullPort, 'getSessionList'>
  let second: Pick<FullPort, 'getSessionList'>
  first = presenter.agentSessionPresenter
  second = first
  return second.getSessionList()
}

export function untypedAssignmentReference(): Promise<unknown> {
  let first
  let second
  first = presenter.agentSessionPresenter as unknown
  second = first
  return (second as any).getActiveSession(1)
}

export function computedReference(method: keyof FullPort): unknown {
  return presenter.agentSessionPresenter[method]
}
