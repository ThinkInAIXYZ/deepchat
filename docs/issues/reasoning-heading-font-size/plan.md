# Plan

## Diagnosis

`ThinkContent.vue` renders reasoning content through `markstream-vue` `NodeRenderer`. The component
sets compact body variables on `.think-prose`, but `markstream-vue` also defines heading-specific
variables such as `--ms-text-h1`, `--ms-text-h2`, and `--ms-text-h3`. Without overriding those
heading variables, markdown headings inside thinking content can render larger than the surrounding
text.

Because `ThinkContent.vue` uses scoped styles and `NodeRenderer` is a child component, selector
fallbacks that target rendered heading elements must use `:deep(...)`.

## Approach

- Override heading font-size and line-height CSS variables in `.think-prose` so markstream headings
  inherit the compact thinking body size.
- Add a scoped `:deep(...)` fallback for rendered `h1` through `h6` and `.heading-node` elements.
- Add a small source-level guard test to keep the reasoning heading overrides from being removed
  accidentally.

## Test Strategy

- Run a focused renderer test that verifies `ThinkContent.vue` contains the heading variable
  overrides and deep heading fallback.
- Run existing thinking block tests.
- Run formatting and renderer quality checks.
