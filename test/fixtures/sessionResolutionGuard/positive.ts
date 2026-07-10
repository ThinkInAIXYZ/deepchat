interface SessionPresenterPort {
  resolveSession(sessionId: string): Promise<unknown>
  resolveSessionList(): Promise<unknown>
  resolveActiveSession(webContentsId: number): Promise<unknown>
  getSession(sessionId: string): Promise<unknown>
  getSessionList(): Promise<unknown>
  getActiveSession(webContentsId: number): Promise<unknown>
}

declare const presenter: { agentSessionPresenter: SessionPresenterPort }

export function directReference(): Promise<unknown> {
  return presenter.agentSessionPresenter.getSession('session-1')
}

export function aliasedReference(): Promise<unknown> {
  const sessionPresenter = presenter.agentSessionPresenter as Pick<
    SessionPresenterPort,
    'getSessionList'
  >
  const alias = sessionPresenter
  return alias.getSessionList()
}

export function destructuredReference(): Promise<unknown> {
  const sessionPresenter = presenter.agentSessionPresenter as Pick<
    SessionPresenterPort,
    'getActiveSession'
  >
  const { getActiveSession } = sessionPresenter
  return getActiveSession(1)
}

export function boundReference(): (sessionId: string) => Promise<unknown> {
  const sessionPresenter = presenter.agentSessionPresenter as Pick<
    SessionPresenterPort,
    'getSession'
  >
  return sessionPresenter.getSession.bind(sessionPresenter)
}

export function destructuredRootReference(): Promise<unknown> {
  const { agentSessionPresenter } = presenter
  return agentSessionPresenter.getSession('session-1')
}

export function typedReference(sessionPresenter: SessionPresenterPort): Promise<unknown> {
  return sessionPresenter.getSessionList()
}

export function computedReference(method: keyof SessionPresenterPort): unknown {
  return presenter.agentSessionPresenter[method]
}
