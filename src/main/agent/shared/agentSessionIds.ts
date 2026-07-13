declare const appSessionIdBrand: unique symbol
declare const acpRemoteSessionIdBrand: unique symbol

export type AppSessionId = string & { readonly [appSessionIdBrand]: 'AppSessionId' }
export type AcpRemoteSessionId = string & {
  readonly [acpRemoteSessionIdBrand]: 'AcpRemoteSessionId'
}

export const toAppSessionId = (value: string): AppSessionId => value as AppSessionId
export const toAcpRemoteSessionId = (value: string): AcpRemoteSessionId =>
  value as AcpRemoteSessionId
