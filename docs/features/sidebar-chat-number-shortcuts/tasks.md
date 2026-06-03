# Tasks — Sidebar Chat Number Shortcuts

- [x] Sidebar mapping: derive first ten visible chat sessions from expanded pinned and grouped
      renderer state.
- [x] Platform handling: detect macOS vs Windows/Linux and build display labels (`⌘N` vs `Alt+N`).
- [x] Keyboard runtime: add mounted window listeners for digit switching and 0.5 second modifier hold.
- [x] Focus guards: suppress shortcuts in editable fields and active keyboard-owning overlays.
- [x] Badge rendering: add sidebar item props and render right-slot shortcut badges over the delete
      button.
- [x] State separation: keep shortcut badge visibility independent from row hover/focus delete
      triggers.
- [x] i18n: add shortcut badge aria/tooltip strings and synchronize locale files.
- [x] Tests: cover mapping, platform modifiers, focus suppression, long-press timer, and delete
      button replacement, including hover/long-press separation.
- [x] Quality gates: run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [ ] Manual QA: verify desktop behavior for normal, searched, collapsed, pinned, and less-than-ten
      chat lists.
