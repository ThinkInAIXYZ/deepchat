# QQBot Remote Settings Clone Error Plan

## Steps

1. Identify where Vue reactive settings are converted into route payloads.
2. Build settings drafts from raw Vue state using explicit channel contract fields.
3. Clone array and nested object fields before invoking the remote control client.
4. Add renderer tests that assert save payloads are structured-cloneable.
5. Run focused tests plus project checks.

## Side Effects

- Save payloads no longer preserve Vue proxy identity.
- Legacy or unknown fields already present in loaded settings are omitted from save payloads.
