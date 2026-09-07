export const MAX_SKILL_TAPE_IDENTITY_BYTES = 1024

export function isBoundedSkillTapeIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_SKILL_TAPE_IDENTITY_BYTES
  )
}
