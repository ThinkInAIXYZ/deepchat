class UnrelatedSessionCache {
  getSession(): unknown {
    return null
  }

  getSessionList(): unknown[] {
    return []
  }

  getActiveSession(): unknown {
    return null
  }
}

export function unrelatedReferences(cache: UnrelatedSessionCache): unknown[] {
  const alias = cache
  const { getActiveSession } = alias
  const bound = alias.getSession.bind(alias)
  return [bound(), alias.getSessionList(), getActiveSession.call(alias)]
}

class UnrelatedContainer {
  agentSessionPresenter = new UnrelatedSessionCache()
}

export function unrelatedNestedClass(container: UnrelatedContainer): unknown {
  return container.agentSessionPresenter.getSession()
}

export function unrelatedNestedAny(container: any): unknown {
  return container.agentSessionPresenter.getSession()
}

export function unrelatedAnyDestructuring(container: any): unknown {
  let getSession: () => unknown
  ;({ getSession } = container.agentSessionPresenter)
  return getSession()
}

interface IAgentSessionPresenter {
  getSession(): unknown
}

export function unrelatedSameNamedPort(
  sessionPresenter: Pick<IAgentSessionPresenter, 'getSession'>
): unknown {
  return sessionPresenter.getSession()
}

export function unrelatedParameterDestructuring({
  getSession
}: Pick<IAgentSessionPresenter, 'getSession'>): unknown {
  return getSession()
}

export function unrelatedAssignmentDestructuring(
  sessionPresenter: Pick<IAgentSessionPresenter, 'getSession'>
): unknown {
  let getSession: () => unknown
  ;({ getSession } = sessionPresenter)
  return getSession()
}
