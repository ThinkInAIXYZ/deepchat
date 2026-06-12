export const REMOTE_CONTROL_ERROR_MESSAGES = {
  acpDefaultWorkdirRequired: 'ACP remote agent requires a channel default directory.'
} as const

export const isAcpDefaultWorkdirRequiredError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  return error.message.includes(REMOTE_CONTROL_ERROR_MESSAGES.acpDefaultWorkdirRequired)
}
