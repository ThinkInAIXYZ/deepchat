export type ErrorNotification = {
  id: string
  title: string
  message: string
  type: string
}

export type SystemNotificationPayload = {
  id: string
  title: string
  body: string
  silent?: boolean
}
