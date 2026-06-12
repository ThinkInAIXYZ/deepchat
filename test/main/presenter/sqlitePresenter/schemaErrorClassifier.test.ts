import { describe, expect, it } from 'vitest'
import {
  buildDatabaseRepairSuggestedPayload,
  classifySchemaError
} from '../../../../src/main/presenter/sqlitePresenter/schemaErrorClassifier'

describe('schemaErrorClassifier', () => {
  it('classifies missing column errors', () => {
    expect(
      classifySchemaError(
        new Error('table deepchat_sessions has no column named reasoning_visibility')
      )
    ).toEqual({
      reason: 'missing-column',
      dedupeKey: 'missing-column:reasoning_visibility'
    })
  })

  it('classifies missing table errors', () => {
    expect(classifySchemaError(new Error('no such table: deepchat_message_traces'))).toEqual({
      reason: 'missing-table',
      dedupeKey: 'missing-table:deepchat_message_traces'
    })
  })

  it('builds a repair suggestion payload for repairable schema errors', () => {
    expect(
      buildDatabaseRepairSuggestedPayload(
        new Error('table deepchat_sessions has 14 columns but 16 values were supplied')
      )
    ).toEqual({
      title: 'settings.data.databaseRepair.toastSuggestedTitle',
      message: 'settings.data.databaseRepair.toastSuggestedDescription',
      reason: 'column-count-mismatch',
      dedupeKey: 'column-count-mismatch:deepchat_sessions'
    })
  })
})
