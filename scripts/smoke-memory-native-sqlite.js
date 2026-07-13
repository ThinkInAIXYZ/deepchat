import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3-multiple-ciphers'

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-memory-sqlite-smoke-'))
const databasePath = path.join(temporaryDirectory, 'memory-smoke.db')
const encryptionKey = 'deepchat-memory-native-smoke'

function openDatabase() {
  const database = new Database(databasePath)
  database.pragma(`key='${encryptionKey}'`)
  return database
}

try {
  const database = openDatabase()
  database.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
  database.prepare('INSERT INTO smoke (value) VALUES (?)').run('ready')
  database.close()

  const reopened = openDatabase()
  const row = reopened.prepare('SELECT value FROM smoke WHERE id = 1').get()
  reopened.close()

  if (row?.value !== 'ready') {
    throw new Error('Native SQLite smoke read did not match the persisted value')
  }

  console.log('[Memory SQLite Smoke] native open/read/write/reopen/close passed')
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
}
