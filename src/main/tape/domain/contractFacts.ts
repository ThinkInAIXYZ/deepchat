export const CONTRACT_TAPE_EVENT_NAMES = ['contract/task_frozen', 'contract/evaluated'] as const

export type ContractTapeEventName = (typeof CONTRACT_TAPE_EVENT_NAMES)[number]

export function isContractTapeReservedName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith('contract/')
}
