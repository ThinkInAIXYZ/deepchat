# Single WebContents Architecture

**Status**: Draft Specification
**Created**: 2026-01-16
**Target Version**: 2.0.0

## Overview

This specification proposes a major architectural refactoring of DeepChat's window and tab management system. The goal is to simplify the codebase by migrating from a multi-WebContentsView architecture to a single WebContents with Vue Router-based navigation for chat windows, while preserving the existing shell architecture for browser windows.

## Quick Links

- **[Specification](./spec.md)** - Complete technical specification
- **[Research](./research.md)** - Detailed analysis of current architecture
- **[Implementation Plan](./plan.md)** - Step-by-step migration guide (TBD)

## Key Changes

### Current Architecture
```
Chat Window = Shell WebContents + Multiple WebContentsViews (one per tab)
Browser Window = Shell WebContents + Multiple WebContentsViews (one per web page)
```

### Proposed Architecture
```
Chat Window = Single WebContents with Vue Router
Browser Window = Shell WebContents + Multiple WebContentsViews (unchanged)
```

## Benefits

- **Performance**: 2-5x faster tab switching
- **Simplicity**: 67% reduction in TabPresenter code
- **Memory**: 80% less memory per tab
- **Developer Experience**: Unified codebase, no shell/main split
- **User Experience**: Smoother transitions, better state persistence

## Trade-offs

- **State Management**: Need careful tab-scoped state isolation
- **Memory Growth**: Keep-alive components stay in memory (mitigated by limits)
- **Migration Effort**: ~8-10 weeks of development

## Current Status

- ✅ Research completed
- ✅ Specification written
- ⏳ Implementation plan (in progress)
- ⏳ Prototype (pending)
- ⏳ Migration (pending)

## Open Questions

1. Should ACP workspace tabs use single WebContents or WebContentsView?
2. What should be the default keep-alive max component count?
3. Should we support tab detachment into new windows (Phase 2)?

## Next Steps

1. Review and approve this specification
2. Create detailed implementation plan
3. Build proof-of-concept prototype
4. Gather team feedback
5. Begin phased migration

## Contributing

Please review the [specification](./spec.md) and provide feedback on:
- Technical approach
- Migration strategy
- Open questions
- Success criteria

## References

- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Vue Router](https://router.vuejs.org/)
- [Pinia State Management](https://pinia.vuejs.org/)
