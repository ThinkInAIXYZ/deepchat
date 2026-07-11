export const ImportMode = {
  INCREMENT: 'increment',
  OVERWRITE: 'overwrite'
} as const

export type ImportMode = (typeof ImportMode)[keyof typeof ImportMode]
