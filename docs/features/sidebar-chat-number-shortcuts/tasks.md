# Tasks — Sidebar Chat Number Shortcuts

- [ ] Sidebar mapping: derive first ten visible chat sessions from expanded pinned and grouped
      renderer state.
- [ ] Platform handling: detect macOS vs Windows/Linux and build display labels (`⌘N` vs `Alt+N`).
- [ ] Keyboard runtime: add mounted window listeners for digit switching and 2 second modifier hold.
- [ ] Focus guards: suppress shortcuts in editable fields and active keyboard-owning overlays.
- [ ] Badge rendering: add sidebar item props and render right-slot shortcut badges over the delete
      button.
- [ ] State separation: keep shortcut badge visibility independent from row hover/focus delete
      triggers.
- [ ] i18n: add shortcut badge aria/tooltip strings and synchronize locale files.
- [ ] Tests: cover mapping, platform modifiers, focus suppression, long-press timer, and delete
      button replacement, including hover/long-press separation.
- [ ] Quality gates: run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [ ] Manual QA: verify desktop behavior for normal, searched, collapsed, pinned, and less-than-ten
      chat lists.
