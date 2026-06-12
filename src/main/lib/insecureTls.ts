import { is } from '@electron-toolkit/utils'

export function isInsecureTlsAllowed(): boolean {
  return is.dev || process.env.DEEPCHAT_ALLOW_INSECURE_TLS === '1'
}
