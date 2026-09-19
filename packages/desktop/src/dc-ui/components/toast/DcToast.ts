import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import type { TransientNotificationKind } from '@renderer-notifications/notificationTypes'

export interface DcToastOptions {
  title: string
  description?: string
  code?: string
}

const notify = (kind: TransientNotificationKind, options: DcToastOptions) => {
  notifyRenderer({
    kind,
    code: options.code ?? crypto.randomUUID(),
    title: options.title,
    description: options.description
  })
}

export const DcToast = {
  success: (options: DcToastOptions) => notify('success', options),
  info: (options: DcToastOptions) => notify('info', options),
  warning: (options: DcToastOptions) => notify('warning', options),
  error: (options: DcToastOptions) => notify('error', options)
}
