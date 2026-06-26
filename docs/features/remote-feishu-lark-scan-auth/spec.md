# Remote Feishu/Lark Scan Authorization

## User Need

DeepChat already supports Feishu/Lark remote control through a manually configured self-built bot app. Users want a guided Kun-style setup that avoids local OAuth callback configuration and minimizes developer-console work. They also need the official PersonalAgent install link to be available in two explicit modes: open the official web page, or show an in-app QR code generated from the same install link. Manual `/pair` pairing and OAuth scan authorization should be presented as complementary ways to authorize remote-control users instead of disconnected flows.

## Goals

- Add an official Feishu/Lark PersonalAgent install flow that can obtain bot App ID/App Secret through Feishu/Lark authorization, without requiring users to configure a local OAuth redirect URI.
- Expose two install actions in Remote settings > Feishu/Lark:
  - open the official web install page externally;
  - show an in-app QR dialog whose QR payload is exactly the official `installUrl` returned by the install session.
- Keep the existing manual configuration fields: brand, App ID, App Secret, verification token, encrypt key, enable switch, default agent, default workdir, pair-code dialog, and bindings management.
- Present manual `/pair <code>` and OAuth scan authorization in the same Feishu/Lark user-authorization section:
  - `/pair <code>` remains the universal bot-command pairing path;
  - OAuth scan authorization remains an optional fallback for users who already configured App ID/App Secret.
- Support both Feishu and Lark tenants:
  - begin registration on `accounts.feishu.cn` for both brands so the QR launcher is accepted by Feishu/Lark clients;
  - switch polling to `accounts.larksuite.com` only after `tenant_brand=lark` is detected without a secret.
- Auto-save returned PersonalAgent credentials into the existing Feishu settings shape and use the returned user `open_id` for pairing if the registration response provides one.

## Acceptance Criteria

1. In Remote settings > Feishu/Lark, users can still manually edit and save all existing credentials and remote-control settings.
2. Users can start an official PersonalAgent install session without entering App ID/App Secret first.
3. The install section has separate buttons for opening the official web page and for showing an in-app QR code.
4. The QR install button shows a dialog containing a QR code generated locally from the returned `installUrl`; it does not open the external browser automatically.
5. The web install button opens the returned `installUrl` externally and continues waiting for the same install result.
6. The install flow calls the official app registration endpoint with `action=begin`, `archetype=PersonalAgent`, `auth_method=client_secret`, and `request_user_info=open_id tenant_brand`, then polls with `action=poll` and `device_code`.
7. On successful install, DeepChat stores the returned `client_id` as App ID, `client_secret` as App Secret, and tenant brand as Feishu/Lark brand; secrets are never logged.
8. If the poll response includes an authorized user `open_id`, DeepChat adds it to `pairedUserOpenIds`; no user OAuth access token or refresh token is persisted.
9. The existing local-callback OAuth pairing flow must not be the primary setup path and must not require users to configure `http://127.0.0.1:32178/remote/feishu/auth/callback`.
10. Users can still use `/pair <code>` exactly as before, and the Feishu/Lark settings UI explains how `/pair` and OAuth scan authorization feed the same authorized-user list.
11. The UI presents the no-manual-callback install path first, with manual developer-console setup as an advanced/fallback path.
12. Cancelling or timing out a Feishu/Lark install or scan-authorization session prevents any later in-flight async response from writing credentials, paired users, or rebuilding runtime.

## Constraints

- Do not weaken existing Feishu message authorization: group/topic messages still require a paired user and bot mention.
- Do not store Feishu user access tokens or refresh tokens in the remote-control config.
- Do not remove manual configuration paths.
- Do not log secrets, tokens, authorization codes, full QR URLs, or provider raw error bodies.
- Generate the install QR locally; do not send the install URL to a third-party QR service.
- Use typed routes and renderer API client methods rather than legacy presenter calls.
- Preserve unrelated local changes already present in the working tree.

## Non-goals

- Guaranteeing Feishu/Lark's undocumented PersonalAgent registration endpoint is stable or officially supported beyond observed Kun/SDK behavior.
- Automating tenant administrator approval when a tenant policy blocks PersonalAgent authorization.
- Replacing the existing Feishu WebSocket event stream runtime.
- Changing the Feishu MCP plugin settings flow.
- Replacing `/pair` with OAuth scan authorization.

## Open Questions

- None for implementation. Risk note: the PersonalAgent registration endpoint is inferred from Kun and official CLI/SDK behavior rather than a separately verified public Feishu documentation page.
