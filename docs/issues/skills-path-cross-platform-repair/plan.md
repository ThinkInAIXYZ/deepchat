# Skills Path Cross-Platform Repair Plan

## Approach

Extend `SkillPresenter.resolveSkillsDir()` with a small default-path repair step. The repair only
matches paths that look like DeepChat's default skills location under an OS user home directory:

- `/Users/<name>/.deepchat/skills`
- `<drive>:\Users\<name>\.deepchat\skills`

If matched, return the same suffix under the current `app.getPath('home')` default skills root.
This keeps intentionally custom paths unchanged while covering stale OS/account defaults.

## Compatibility

The current malformed path repair for `C:\Users\name.deepchat\skills` is preserved. Existing valid
configured paths continue to resolve through `path.resolve()`.

## Test Strategy

Add constructor-level `getSkillsDir()` assertions in `skillPresenter.test.ts` for:

- POSIX stale default path repair.
- Windows stale default path repair.
- Existing malformed `.deepchat` repair remains unchanged.
