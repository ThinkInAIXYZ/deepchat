import { z } from 'zod'

export const PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS = 512
const PROGRAMMATIC_TOOL_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\p{Cs}]/u

export const ProgrammaticToolInvocationNameSchema = z
  .string()
  .min(1)
  .max(PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS)
  .refine((value) => value === value.trim() && !PROGRAMMATIC_TOOL_CONTROL_PATTERN.test(value), {
    message: 'Programmatic Tool name must be canonical'
  })

export const ProgrammaticToolPropertyNameSchema = z
  .string()
  .max(PROGRAMMATIC_TOOL_NAME_MAX_CHARACTERS)
  .refine((value) => !PROGRAMMATIC_TOOL_CONTROL_PATTERN.test(value), {
    message: 'Programmatic Tool property name must not contain control characters'
  })
