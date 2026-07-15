export interface DialogButton {
  key: string
  label: string
  default?: boolean
}

export interface DialogIcon {
  icon: string
  class: string
}

export interface DialogRequestParams {
  title: string
  description?: string
  i18n?: boolean
  icon?: DialogIcon
  buttons?: DialogButton[]
  timeout?: number
}

export interface DialogRequest {
  id: string
  title: string
  description?: string
  i18n: boolean
  icon?: DialogIcon
  buttons: DialogButton[]
  timeout: number
}

export interface DialogResponse {
  id: string
  button: string
}

export interface DialogServicePort {
  showDialog(request: DialogRequestParams): Promise<string>
  handleDialogResponse(response: DialogResponse): Promise<void>
  handleDialogError(id: string): Promise<void>
}
