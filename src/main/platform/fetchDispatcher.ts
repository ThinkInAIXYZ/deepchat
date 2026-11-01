import { Agent, EnvHttpProxyAgent } from 'undici'

// Model cancellation owns slow first-token and response-body deadlines.
export const FETCH_DISPATCHER_TIMEOUTS = {
  headersTimeout: 0,
  bodyTimeout: 0
} as const

export function createGlobalFetchDispatcher(proxy?: {
  httpProxy: string
  httpsProxy: string
  noProxy: string
}): Agent | EnvHttpProxyAgent {
  return proxy
    ? new EnvHttpProxyAgent({ ...proxy, ...FETCH_DISPATCHER_TIMEOUTS })
    : new Agent(FETCH_DISPATCHER_TIMEOUTS)
}

export function applyProxyEnvironment(proxyUrl: string | null, noProxy: string): void {
  for (const key of [
    'http_proxy',
    'https_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'GRPC_PROXY',
    'grpc_proxy'
  ]) {
    if (proxyUrl === null) delete process.env[key]
    else process.env[key] = proxyUrl
  }
  for (const key of ['no_proxy', 'NO_PROXY']) {
    if (proxyUrl === null) delete process.env[key]
    else process.env[key] = noProxy
  }
}
