import type { InjectionKey } from 'vue'
import { inject, type Ref } from 'vue'
import type { DcFormSubmitStatus } from './useDcFormSubmit'

export const DC_FORM_INJECTION_KEY: InjectionKey<DcFormContext> = Symbol('DcForm')

export interface DcFormContext {
  status: Ref<DcFormSubmitStatus>
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  reset: () => void
}

export function useDcForm(): DcFormContext | null {
  return inject(DC_FORM_INJECTION_KEY, null)
}
