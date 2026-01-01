export function enhanceSystemPromptWithDateTime(
  systemPrompt: string,
  isImageGeneration: boolean = false
): string {
  if (isImageGeneration || !systemPrompt || !systemPrompt.trim()) {
    return systemPrompt
  }

  const currentDateTime = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false
  })

  return `${systemPrompt}\nToday is ${currentDateTime}`
}
