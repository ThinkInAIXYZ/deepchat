# Local verification

Use the Node and pnpm versions required by `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Local Mem

1. Start Nowledge Mem on the same computer as DeepChat.
2. Open Plugins > Nowledge Mem > Local. Enter `http://127.0.0.1:14242`. If authentication is
   enabled, enter its API key in the password field.
3. Click Verify and save. Expect a success message, API base `http://127.0.0.1:14242`, MCP
   `http://127.0.0.1:14242/mcp/`, and a cleared key input. Verification includes REST and an MCP
   context read, so a health response alone cannot produce success.
4. Enable the plugin. Select `nowledge-mem-local` in the agent/session MCP controls and use the
   Nowledge Skill to read working context. The unconfigured remote server must remain inactive.

## Remote Mem alongside local Mem

1. In the same plugin, select Remote and enter `https://mem.example.com` (or your server).
2. Enter that server's API key securely, or obtain a fresh one-time connect link from its App and
   paste it into the password field. Use one credential method per save. A consumed link is cleared;
   request a new link if redemption or subsequent verification fails.
3. For a deployment explicitly using the legacy routes, expand Advanced endpoints and enter API
   base `https://mem.example.com/remote-api` and MCP
   `https://mem.example.com/remote-api/mcp/`. Otherwise leave overrides empty. Root routes are tried
   first; only a missing REST route (404) permits trying `/remote-api`. Authentication failures,
   TLS failures and timeouts stop immediately.
4. Verify and save, then select `nowledge-mem-remote` for the agent. Local remains independently
   available. With both MCP servers selected, specify which connection to use in the request.
5. Click Use for exports on the desired profile. This changes the default REST destination;
   agent/session MCP selection remains independent.

DeepChat owns these connections. It does not read ambient `NMEM_*` variables or modify the nmem CLI,
Codex, or another tool's configuration. Advanced fields show the effective API/MCP destinations.

## Send a conversation

1. Open a conversation containing sent messages. Use its menu > Send to Nowledge Mem.
2. Check the displayed session title and destination, then confirm. A matching server
   acknowledgement is required before the success notification.
3. Check the thread in the selected Mem. Repeat the export, then rename the chat and export again;
   expect the same thread with no duplicate messages. Add a message and export to check incremental
   import. The server must support `/threads/import`; an older server returns an upgrade error. Unsent drafts must be absent. The `.json` export menu item
   downloads a file and does not send it.
4. Change the profile's API destination while its confirmation is open, then confirm. Expect an
   error asking you to confirm again; the request must not silently use the replacement destination.

## Failure, import and restart

- Enter a wrong replacement key and save. Expect an authentication error, with the previously
  verified endpoints, credentials and export choice preserved. No request should go to localhost.
- Edit a saved destination. Saving requires the replacement checkbox and credentials for that
  destination. The old credential is retained for reconnecting to its exact API/MCP pair.
- If legacy export settings or a user-owned `nowledge-mem` MCP entry exist, load the appropriate
  import candidate and verify explicitly. Old MCP entries remain user-owned. An imported export
  key is removed from the old plaintext setting only after encrypted storage succeeds.
- Disable the plugin: its MCP tools and Skill disappear. Enable it and restart DeepChat: saved
  endpoints, export choice and encrypted credentials remain usable. The key input stays empty.
- Open the separate settings window > Knowledge Base > Nowledge Mem. Expect the settings-window
  plugin page and its working configuration form, without a router error.
- Clear all connections, confirm, and check that the plugin is disabled and both profiles are empty.
  Reconnecting requires entering credentials again, including for previous destinations.
- Stop the server and verify: expect a connection error and unchanged saved state.

## Automated checks

```bash
pnpm exec vitest run --config vitest.config.ts test/main/nowledgeMem test/main/exporter test/main/plugin test/main/mcp test/main/sync test/main/scripts/packagePlugin.test.ts test/main/scripts/packageWorkflow.test.ts test/main/scripts/packageContract.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/api/clients.test.ts test/renderer/components/NowledgeMemSettings.test.ts test/renderer/components/KnowledgeBaseSettings.test.ts test/renderer/components/chat/ChatTopBar.test.ts test/renderer/components/PluginsSettings.test.ts test/renderer/components/OfficialPluginDetailPage.test.ts
pnpm build
pnpm exec playwright test -c test/e2e/playwright.config.ts 04-settings-navigation.smoke.spec.ts 12-knowledge-readonly-route.smoke.spec.ts 14-nowledgemem-config-route.smoke.spec.ts
```

The Electron smoke test uses a disposable local authenticated Mem fixture and isolated app data.
It verifies real REST/MCP access, protected renderer state, rejected key replacement and plugin
disable/enable recovery. It does not upload data to your Mem or modify another AI tool.
