const STARTUP_DEEPLINK_ENV_KEY = 'STARTUP_DEEPLINK'
const SECONDARY_STARTUP_ENV_KEYS = ['DEEPLINK_URL', 'deepchat_deeplink'] as const
let pendingStartupDeepLink: string | null = null

export const isDeepLinkUrl = (value: string | null | undefined): value is string => {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim()
  return normalized.startsWith('deepchat://') || normalized.startsWith('deepchat:')
}

export const normalizeDeepLinkUrl = (value: string): string => value.trim()

export const findDeepLinkArg = (argv: readonly string[]): string | null => {
  const matched = argv.find((arg) => isDeepLinkUrl(arg))
  return matched ? normalizeDeepLinkUrl(matched) : null
}

export const readStartupDeepLinkFromEnv = (env: NodeJS.ProcessEnv = process.env): string | null => {
  if (pendingStartupDeepLink) {
    return pendingStartupDeepLink
  }

  const stored = env[STARTUP_DEEPLINK_ENV_KEY]
  return isDeepLinkUrl(stored) ? normalizeDeepLinkUrl(stored) : null
}

export const findStartupDeepLink = (
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null => {
  const stored = readStartupDeepLinkFromEnv(env)
  if (stored) {
    return stored
  }

  const deepLinkArg = findDeepLinkArg(argv)
  if (deepLinkArg) {
    return deepLinkArg
  }

  for (const key of SECONDARY_STARTUP_ENV_KEYS) {
    const value = env[key]
    if (isDeepLinkUrl(value)) {
      return normalizeDeepLinkUrl(value)
    }
  }

  return null
}

export const storeStartupDeepLink = (
  url: string,
  _env: NodeJS.ProcessEnv = process.env
): string | null => {
  if (!isDeepLinkUrl(url)) {
    return null
  }

  const normalized = normalizeDeepLinkUrl(url)
  pendingStartupDeepLink = normalized
  return normalized
}

export const consumeStartupDeepLink = (_env: NodeJS.ProcessEnv = process.env): string | null => {
  const stored = pendingStartupDeepLink
  pendingStartupDeepLink = null
  return stored
}
