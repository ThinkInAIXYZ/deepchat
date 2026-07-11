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

export function unrelatedClassRest(cache: UnrelatedSessionCache): unknown {
  const { ...rest } = cache
  return rest.getSession()
}

export function unrelatedAnyRest(container: any): unknown {
  const { ...rest } = container
  return rest.getSession()
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

export function unrelatedParameterRest({
  ...rest
}: Pick<IAgentSessionPresenter, 'getSession'>): unknown {
  return rest.getSession()
}

export function unrelatedAssignmentDestructuring(
  sessionPresenter: Pick<IAgentSessionPresenter, 'getSession'>
): unknown {
  let getSession: () => unknown
  ;({ getSession } = sessionPresenter)
  return getSession()
}

export function unrelatedAssignmentRest(cache: UnrelatedSessionCache): unknown {
  let rest
  ;({ ...rest } = cache)
  return rest.getSession()
}
