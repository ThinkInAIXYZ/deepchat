# Renderer Locale Lazy Loading

## Loading Contract

Chat main, Settings, and floating renderers register only their current locale and the `en-US`
fallback during startup. `src/renderer/src/i18n/index.ts` contains an explicit loader registry with
Vite-analyzable dynamic imports; other locale chunks load on first use and reuse the cached load.
There is no synchronous aggregate import of all locale message bodies.

Each app obtains a usable i18n instance before `app.mount()`. Bootstrap reads the resolved language
from main and registers its messages before exposing the locale. IPC or locale-load failure still
allows startup with locally available `en-US` fallback messages.

## Runtime Switching

Language changes follow this order:

```text
request language -> load messages -> register messages -> publish locale and direction
```

Only the latest request may publish locale, requested language, and direction. An older asynchronous
result cannot overwrite a newer choice. A failed load cannot select an unregistered locale.
Plural rules, explicit LTR/RTL direction, supported-locale normalization, and `system` semantics remain
consistent across the three apps.

## Boundaries

- Each renderer owns its Vue/Pinia/i18n runtime instance.
- The registry loads packaged chunks and adds no network dependency.
- Startup fallback cannot reintroduce the full synchronous messages aggregate.
- Language settings continue through `config.getLanguage` and `config.setLanguage` without a
  persistence or IPC format change.
- This contract does not split namespaces inside a locale or change translations, supported
  languages, main locale resolution, or Settings layout.

## Regression Protection

Loader caching, bootstrap fallback, switch races, and direction are protected by renderer tests.
A production build must retain separate asynchronous locale chunks and keep translation bodies out
of the synchronous Settings entry. Historic bundle sizes and suite counts are not current budgets.
