import type { z } from 'zod'

export interface RouteContract<
  Name extends string = string,
  InputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny = z.ZodTypeAny
> {
  name: Name
  input: InputSchema
  output: OutputSchema
}

export interface EventContract<
  Name extends string = string,
  PayloadSchema extends z.ZodTypeAny = z.ZodTypeAny
> {
  name: Name
  payload: PayloadSchema
}

export function defineRouteContract<
  const Name extends string,
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny
>(contract: {
  name: Name
  input: InputSchema
  output: OutputSchema
}): RouteContract<Name, InputSchema, OutputSchema> {
  return contract
}

export function defineEventContract<
  const Name extends string,
  PayloadSchema extends z.ZodTypeAny
>(contract: { name: Name; payload: PayloadSchema }): EventContract<Name, PayloadSchema> {
  return contract
}
