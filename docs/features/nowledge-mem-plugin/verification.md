# Local verification

Use the Node and pnpm versions required by `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Connect a Mem server

1. Open Plugins > Nowledge Mem. The form has two inputs: Server URL and API key (optional).
2. Enter your address: `http://127.0.0.1:14242` for a Mem running on this computer, an HTTP/HTTPS
   LAN address, or a remote address such as `https://mem.example.com`. A deployment with a known
   API prefix can use `https://mem.example.com/remote-api` directly.
3. Enter the server's API key if it requires one; otherwise leave it blank. Click Verify and save.
   Expect a success message and a cleared key input. Verification includes REST authentication
   and a read-only MCP context call. A 401/403 or network error preserves the saved connection.
4. Enable the plugin and select `nowledge-mem-connection` in agent/session MCP controls.
   API exports and MCP use the same verified server; no separate export selection is needed.
5. Change the address and save. Confirm the new destination in the dialog. Prior credentials
   remain bound to the original address and are never supplied to the new server.

DeepChat does not read ambient `NMEM_*` variables or modify nmem or another AI tool's settings.
A server root resolves to `/mcp/`. Only a missing REST route (404) permits trying `/remote-api`.

## Send a conversation

1. Open a conversation containing sent messages. Use its menu > Send to Nowledge Mem.
2. Check the displayed session title and destination, then confirm. A matching server
   acknowledgement is required before the success notification.
3. Check the thread in the selected Mem. Repeat the export, then rename the chat and export again;
   expect the same thread with no duplicate messages. Add a message and export to check incremental
   import. The server must support `/threads/import`; an older server returns an upgrade error. Unsent drafts must be absent. The `.json` export menu item
   downloads a file and does not send it.
4. Change the saved destination while its confirmation is open, then confirm. Expect an
   error asking you to confirm again; the request must not silently use the replacement destination.

## Failure, import and restart

- Enter a wrong replacement key and save. Expect an authentication error, with the previously
  verified endpoints and credentials preserved. No request should go to localhost.
- Edit a saved destination. Saving asks for confirmation. Enter credentials if that destination requires them. The old credential is retained for reconnecting to its exact API/MCP pair.
- If legacy export settings or a user-owned `nowledge-mem` MCP entry exist, load the appropriate
  import candidate and verify explicitly. Old MCP entries remain user-owned. An imported export
  key is removed from the old plaintext setting only after encrypted storage succeeds.
- Disable the plugin: its MCP tools and Skill disappear. Enable it and restart DeepChat: saved
  endpoints and encrypted credentials remain usable. The key input stays empty.
- Open the separate settings window > Knowledge Base > Nowledge Mem. Expect the settings-window
  plugin page and its working configuration form, without a router error.
- Clear connection, confirm, and check that the plugin is disabled and its connection is empty.
  Reconnecting requires entering credentials again, including for previous destinations.
- Stop the server and verify: expect a connection error and unchanged saved state.

## Automated checks

```bash
pnpm exec vitest run --config vitest.config.ts test/main/nowledgeMem test/main/exporter test/main/plugin test/main/mcp test/main/sync test/main/scripts/packagePlugin.test.ts test/main/scripts/packageWorkflow.test.ts test/main/scripts/packageContract.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/components/NowledgeMemSettings.test.ts test/renderer/components/KnowledgeBaseSettings.test.ts test/renderer/components/chat/ChatTopBar.test.ts test/renderer/components/PluginsSettings.test.ts test/renderer/components/OfficialPluginDetailPage.test.ts
pnpm build
pnpm exec playwright test -c test/e2e/playwright.config.ts 01-launch.smoke.spec.ts 04-settings-navigation.smoke.spec.ts 12-knowledge-readonly-route.smoke.spec.ts 14-nowledgemem-config-route.smoke.spec.ts
```

The Electron smoke test uses a disposable local authenticated Mem fixture and isolated app data.
It verifies real REST/MCP access, protected renderer state, rejected key replacement and plugin
disable/enable recovery. It does not upload data to your Mem or modify another AI tool.

Startup smoke tests restart with an obsolete installed Nowledge manifest and malformed plugin JSON,
then separately with an unusable plugin directory. Both cases must reach the main window and record
a completed startup. A valid source repairs the obsolete manifest; existing configuration remains.
