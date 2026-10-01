# Provider settings integrity

## Goal and scope

Follow up the provider-settings review by verifying each reported defect before changing it.
Preserve the connection summary/editor design and existing authentication implementations.
Saving, enabling, catalog discovery and model verification have independent meanings.
No real credentials, account settings or production data are used for verification.

## Design constraints

- Custom-model identity changes must not delete the original before replacement data is durable.
  Prefer the existing main-process database transaction boundary over renderer compensation.
- Model status keys must distinguish original IDs and retain legacy status when unambiguous;
  do not guess separate historical values for IDs that already collided.
- Failed persistence must not produce success events or silently discard field updates.
- Health belongs to the tested connection configuration, including provider-specific fields.
- Enabling a provider must preserve user order. Testing must not require enabling it.
- Onboarding must target the current connection entry and respect authentication differences.
- Remove the Vertex endpoint-mode control if no runtime consumer exists. Keep required connection
  fields discoverable rather than treating them as optional advanced settings.
- Add an explicit confirmed API-key removal action; blank replacement still preserves the key.
- Allow custom-provider creation without network validation, saved disabled and unverified.
- Preserve the existing visual language, make narrow model actions fit, expose filtered batch
  scope, and localize changed copy in each supported language.

## Delivery and acceptance

Each implementation slice is reviewed for P0–P3 defects before a small Conventional Commit.
Use implementation-first regression coverage, then run targeted ablations: remove a guard or
replacement behavior to establish why it is necessary, restoring it before committing.
Do not introduce a generic settings framework, new dependency, service or provider-specific
fallback probe. Execute quality gates and inspect rendered default and compact states before
pushing to the current PR branch. Do not merge or release.

See plan.md for evidence, slice completion, rejected claims and validation results.
