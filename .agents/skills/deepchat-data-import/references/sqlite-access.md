# SQLite Access And Encryption

Use this reference before opening `agent.db` or `chat.db`.

## Decision Tree

1. Locate `database-security.json`.
2. If the file is absent or `metadata.enabled !== true`, open `agent.db` as plain SQLite.
3. If `metadata.enabled === true`, open with SQLCipher using the DeepChat SQLite password.
4. If `metadata.passwordStorage === "safeStorage"` and `wrappedPassword` exists, first try an
   Electron safeStorage helper.
5. If safeStorage is unavailable, decryption fails, or the importing runtime is not Electron, ask the
   user for the SQLite password and validate it before reading.

Legacy `chat.db` is normally unencrypted. If a user supplies an encrypted database explicitly, treat
it with the same SQLCipher path.

## Opening Unencrypted SQLite

Use a read-only connection when possible:

```sql
SELECT name FROM sqlite_master LIMIT 1;
PRAGMA quick_check;
```

If the importer sees `file is not a database`, `SQLITE_NOTADB`, or `SQLITE_CORRUPT` against
`agent.db`, check `database-security.json` before treating the file as corrupt.

## Opening Encrypted SQLite

DeepChat uses `better-sqlite3-multiple-ciphers` and configures SQLCipher compatibility before
applying the key:

```ts
db.pragma("cipher='sqlcipher'")
db.pragma('legacy=4')
db.key(Buffer.from(password, 'utf8'))
```

Then validate with:

```sql
SELECT name FROM sqlite_master LIMIT 1;
PRAGMA quick_check;
```

For other SQLCipher bindings, choose SQLCipher 4 compatible settings that match the binding's
equivalent of the `legacy=4` mode. Use parameterized or native key APIs when the library supports
them.

## Electron Importer

An Electron-based third-party importer has the best chance of using DeepChat's wrapped password.
Read the metadata JSON manually, then try `safeStorage.decryptString`.

```ts
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

async function readDeepChatPassword(deepChatUserData: string): Promise<string | null> {
  await app.whenReady()
  const metadataPath = path.join(deepChatUserData, 'database-security.json')
  const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
    metadata?: {
      enabled?: boolean
      passwordStorage?: string
      wrappedPassword?: string
    }
  }

  const metadata = raw.metadata
  if (!metadata?.enabled) return undefined
  if (metadata.passwordStorage !== 'safeStorage' || !metadata.wrappedPassword) return null
  if (!safeStorage.isEncryptionAvailable()) return null

  try {
    return safeStorage.decryptString(Buffer.from(metadata.wrappedPassword, 'base64'))
  } catch {
    return null
  }
}
```

If this returns `null`, fall back to a password prompt. SafeStorage blobs are tied to the user's OS
security context and Electron's underlying implementation; cross-app or cross-machine decrypt is not
a stable public contract.

## Tauri Importer

Tauri cannot directly call Electron safeStorage. Prefer this flow:

1. Locate `agent.db` and `database-security.json`.
2. If unencrypted, open with a normal SQLite crate or plugin.
3. If encrypted, ask the user for the SQLite password.
4. Open through a SQLCipher-capable SQLite binding. Standard SQLite drivers will not open encrypted
   `agent.db`.
5. Optionally spawn a small Electron helper only for safeStorage unwrap, then pass the password back
   through a local, user-consented channel.

Use Tauri or OS keyring APIs only to store the importer's own remembered password. Do not assume
they can unwrap DeepChat's Electron safeStorage blob.

## Native macOS, Windows, And Linux

For unencrypted databases, use the platform's normal SQLite library in read-only mode.

For encrypted databases, use a SQLCipher-capable library and ask the user for the SQLite password
unless you deliberately ship an Electron helper.

Platform notes:

- macOS: Electron safeStorage depends on Keychain-backed OS crypto. Native Keychain access can be
  app-permission dependent and should not be treated as a stable DeepChat import API.
- Windows: Electron safeStorage commonly relies on current-user OS protection. Native DPAPI
  experiments may work for some blobs, but the blob format and Electron behavior are implementation
  details. Prefer manual password fallback.
- Linux: safeStorage may use libsecret, KWallet, or a weaker backend reported as
  `safeStorageBackend`. If the user's desktop secret service is unavailable, DeepChat stores
  metadata in manual mode and the importer must ask for the password.

## Validation Errors

- Wrong password usually surfaces as `file is not a database`, `SQLITE_NOTADB`, or a failure reading
  `sqlite_master`.
- A missing WAL file can make recent rows disappear from a copied live database. Re-copy sidecars or
  ask the user to close DeepChat.
- Do not run rekey or migration operations from an importer. DeepChat's own migration flow copies
  through an attached temp database and updates metadata only after validation.
