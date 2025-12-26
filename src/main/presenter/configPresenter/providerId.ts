const PROVIDER_ID_ALIASES: Record<string, string> = {
  dashscope: 'alibaba-cn',
  gemini: 'google',
  zhipu: 'zhipuai',
  vertex: 'google-vertex',
  together: 'togetherai',
  github: 'github-models',
  'azure-openai': 'azure',
  'aws-bedrock': 'amazon-bedrock',
  ppio: 'ppinfra',
  fireworks: 'fireworks-ai'
}

export const resolveProviderId = (providerId: string | undefined): string | undefined => {
  if (!providerId) return undefined
  return PROVIDER_ID_ALIASES[providerId] ?? providerId
}
