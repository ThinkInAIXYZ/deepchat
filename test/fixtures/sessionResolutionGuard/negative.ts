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
