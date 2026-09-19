export const normalizeModelIdText = (value: string | null | undefined): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/^models\//, '') ?? ''

export const getUnqualifiedModelId = (value: string | null | undefined): string => {
  const normalizedModelId = normalizeModelIdText(value)
  return normalizedModelId.includes('/')
    ? normalizedModelId.slice(normalizedModelId.lastIndexOf('/') + 1)
    : normalizedModelId
}

const DOTTED_MODEL_NAMESPACE_SEGMENTS = new Set([
  'ai21',
  'ai21-labs',
  'amazon',
  'anthropic',
  'au',
  'cohere',
  'deepseek',
  'eu',
  'global',
  'google',
  'jp',
  'meta',
  'meta-llama',
  'minimax',
  'mistral',
  'mistralai',
  'moonshot',
  'moonshotai',
  'nvidia',
  'openai',
  'qwen',
  'stepfun',
  'stepfun-ai',
  'us',
  'x-ai',
  'xai',
  'z-ai',
  'zai',
  'zai-org'
])

export const getDottedProviderUnqualifiedModelId = (value: string | null | undefined): string => {
  const normalizedModelId = getUnqualifiedModelId(value)
  const segments = normalizedModelId.split('.')
  let namespaceSegmentCount = 0
  while (
    namespaceSegmentCount < segments.length - 1 &&
    DOTTED_MODEL_NAMESPACE_SEGMENTS.has(segments[namespaceSegmentCount])
  ) {
    namespaceSegmentCount += 1
  }
  if (namespaceSegmentCount > 0) {
    return segments.slice(namespaceSegmentCount).join('.')
  }

  const modelSegmentIndex = segments.findIndex((segment) => segment.includes('-'))

  return modelSegmentIndex > 0 ? segments.slice(modelSegmentIndex).join('.') : normalizedModelId
}

export const normalizeCanonicalModelId = (value: string | null | undefined): string =>
  getDottedProviderUnqualifiedModelId(value)
    .replace(/[_:\s]+/g, '-')
    .replace(/(\d)\.(?=\d)/g, '$1-')
    .replace(/-+/g, '-')
