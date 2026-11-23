import type { VERTEX_PROVIDER } from '@shared/types/provider'

export function normalizeVertexBaseUrl(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  apiVersion: 'v1' | 'v1beta1' = 'v1'
): string | undefined {
  const normalized = baseUrl?.trim().replace(/\/+$/, '')
  if (!normalized || !apiKey) return normalized || undefined
  if (/\/publishers\/google$/i.test(normalized)) return normalized
  return new RegExp(`/${apiVersion}$`, 'i').test(normalized)
    ? `${normalized}/publishers/google`
    : `${normalized}/${apiVersion}/publishers/google`
}

/** Public connection facts only; private keys and access tokens never enter this projection. */
export function resolveVertexSettings(provider: VERTEX_PROVIDER) {
  const apiKey = !!(provider.apiKey || process.env.GOOGLE_VERTEX_API_KEY)
  const apiVersion = provider.apiVersion ?? 'v1'
  if (apiVersion !== 'v1' && apiVersion !== 'v1beta1') throw new Error('Invalid Vertex API version')
  const projectId = provider.projectId || process.env.GOOGLE_VERTEX_PROJECT || ''
  const location = provider.location || process.env.GOOGLE_VERTEX_LOCATION || ''
  if (!apiKey && (!projectId || !location))
    throw new Error('Vertex project and location are required')
  if (location && !/^[a-z][a-z0-9-]{0,62}$/.test(location))
    throw new Error('Invalid Vertex location')
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : location === 'us' || location === 'eu'
        ? `aiplatform.${location}.rep.googleapis.com`
        : `${location}-aiplatform.googleapis.com`
  const baseUrl =
    normalizeVertexBaseUrl(provider.baseUrl, apiKey ? 'configured' : undefined, apiVersion) ??
    (apiKey
      ? `https://aiplatform.googleapis.com/${apiVersion}/publishers/google`
      : `https://${host}/${apiVersion}/projects/${encodeURIComponent(projectId)}/locations/${location}/publishers/google`)
  return {
    apiKey,
    apiVersion,
    projectId,
    location,
    baseUrl,
    accountClientEmail: provider.accountClientEmail ?? ''
  }
}
